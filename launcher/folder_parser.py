from pathlib import Path
from typing import Dict, List


def _collect_adsets(campaign_dir: Path) -> List[Dict]:
    adsets = []
    for adset_dir in sorted(p for p in campaign_dir.iterdir() if p.is_dir()):
        creatives = [
            file_path
            for file_path in sorted(adset_dir.iterdir())
            if file_path.is_file()
        ]
        if creatives:
            adsets.append({"name": adset_dir.name, "creatives": creatives})
    return adsets


def parse_launch_folder(launch_folder_path: str) -> List[Dict]:
    root = Path(launch_folder_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"Launch folder not found: {root}")

    # If the selected folder is the campaign folder, parse it directly.
    adsets = _collect_adsets(root)
    if adsets:
        return [{"name": root.name, "adsets": adsets}]

    # Otherwise, treat children as campaign folders.
    campaigns = []
    for campaign_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        adsets = _collect_adsets(campaign_dir)
        if adsets:
            campaigns.append({"name": campaign_dir.name, "adsets": adsets})

    if not campaigns:
        raise ValueError(f"No campaigns detected in {root}")
    return campaigns
