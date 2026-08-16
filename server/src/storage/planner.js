/**
 * MergerFS + SnapRAID pool planner — pure logic, no I/O.
 *
 * Role assignment: the LARGEST drive becomes the dedicated SnapRAID parity
 * drive (parity must be >= every data drive); all remaining drives become
 * MergerFS data branches glued into one /mnt/pool volume.
 *
 * Files are stored whole on a single branch — never striped — so a dead
 * drive only takes its own files, and every other drive stays readable.
 * New files land on the branch with the Most Free Space (MFS policy).
 */

const sum = drives => drives.reduce((s, d) => s + d.sizeGB, 0);

export function planPool(drives) {
  const sorted = [...drives].sort((a, b) => b.sizeGB - a.sizeGB || a.id.localeCompare(b.id));
  if (sorted.length < 2) {
    return {
      viable: false,
      reason: 'Need at least 2 drives: 1 data + 1 parity',
      parity: null,
      data: sorted,
      usableGB: 0,
      rawGB: sum(sorted),
      policy: 'mfs',
      protected: false,
    };
  }
  const [parity, ...data] = sorted;
  return {
    viable: true,
    parity,
    data,
    usableGB: sum(data),
    rawGB: sum(sorted),
    policy: 'mfs',
    protected: true,
  };
}

/** MFS create policy: new files go to the data branch with the most free space. */
export function pickWriteTarget(branches) {
  if (!branches.length) throw new Error('No data branches');
  return branches.reduce((best, b) => (b.freeGB > best.freeGB ? b : best));
}

export function validatePlan(plan) {
  if (!plan.viable) throw new Error(plan.reason);
  const maxData = Math.max(...plan.data.map(d => d.sizeGB));
  if (plan.parity.sizeGB < maxData) {
    throw new Error('Parity drive must be at least as large as the largest data drive');
  }
  if (plan.data.some(d => d.id === plan.parity.id)) {
    throw new Error('Parity drive cannot also be a data branch');
  }
  return true;
}
