# Custom NAS OS Blueprint (MergerFS + SnapRAID Architecture)

## 🖥️ Web Dashboard & Interface
* **System Monitor:** Real-time visual graphs for CPU speed (3.0+ GHz target), DDR4 RAM usage, and drive temperatures.
* **Web GUI:** Complete headless browser interface for configuration without a terminal.
* **Shared Folders:** Simple creation tool with instant network discovery for Windows and Mac via native SMB/NFS sharing.

## 🎛️ MergerFS Pooling Engine
* **Mix-and-Match Volume:** Automatically glues drives of completely different capacities (e.g., mismatched Intel DC SATA SSDs) into a single `/mnt/pool` mount point.
* **Most Free Space (MFS) Policy:** Intelligently directs new file writes to the physical drive with the most available storage capacity.
* **Independent File Preservation:** Keeps files whole on individual disks rather than striping them, ensuring that if a drive fails, data on the remaining drives stays fully readable.

## 🛡️ SnapRAID Redundancy Engine
* **Dedicated Parity Protection:** Designates the largest drive in the pool to store parity data, allowing full data recovery from a single drive failure.
* **Scheduled Sync Tracking:** Runs automated background `snapraid sync` tasks nightly at 3:00 AM to calculate and update parity data.
* **Data Scrubbing:** Automatically executes weekly integrity checks to detect and repair data corruption or silent file rot.

## 🐳 Docker Container Station
* **App Management:** Visual dashboard to copy, paste, deploy, start, and stop custom file-sharing Docker containers.
* **Persistent Volumes:** Automatic data mapping to keep file-sharing app settings safe during restarts.

## 📦 ISO Build Specifications
* **Base Core:** Standard Debian Stable (Netinst) x64 base for native hardware, driver, and filesystem stability.
* **Auto-Installer:** Pre-configured kickstart script (`preseed.cfg`) for automatic drive partitioning and OS deployment upon USB boot.
* **Bundled Assets:** Embeds the custom Web GUI, MergerFS packages, SnapRAID packages, and Docker engine into a single compressed `custom-nas-os.iso` output.
