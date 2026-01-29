from pathlib import Path
from typing import Dict, List


def _collect_adsets(campaign_dir: Path) -> List[Dict]:
    adsets = []
    for adset_dir in sorted(p for p in campaign_dir.iterdir() if p.is_dir()):
        creatives: List = []
        for entry in sorted(adset_dir.iterdir()):
            if entry.is_dir():
                child_files = [f for f in sorted(entry.iterdir()) if f.is_file() and not f.name.startswith(".")]
                if child_files:
                    creatives.append({"type": "carousel", "name": entry.name, "items": child_files})
            elif entry.is_file():
                creatives.append(entry)
        if creatives:
            adsets.append({"name": adset_dir.name, "creatives": creatives})
    return adsets


def parse_launch_folder(launch_folder_path: str) -> List[Dict]:
    # Support pipe-delimited file selections (multi-file picker)
    if "|" in launch_folder_path:
        paths = [Path(p).expanduser().resolve() for p in launch_folder_path.split("|") if p.strip()]
        files = [p for p in paths if p.is_file()]
        if not files:
            raise FileNotFoundError("No valid files selected.")
        # Derive names from first file
        first = files[0]
        adset_name = first.parent.name or "Adset"
        campaign_name = first.parent.parent.name if first.parent.parent else "ExistingCampaign"
        return [{"name": campaign_name, "adsets": [{"name": adset_name, "creatives": files}]}]

    root = Path(launch_folder_path).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"Launch folder not found: {root}")

    # If the selected folder is the campaign folder, parse it directly.
    adsets = _collect_adsets(root)
    if adsets:
        return [{"name": root.name, "adsets": adsets}]

    # If the folder itself looks like a single ad set (files and/or carousel subfolders), wrap it.
    creatives: List = []
    for entry in sorted(root.iterdir()):
        if entry.is_dir():
            child_files = [f for f in sorted(entry.iterdir()) if f.is_file() and not f.name.startswith(".")]
            if child_files:
                creatives.append({"type": "carousel", "name": entry.name, "items": child_files})
        elif entry.is_file():
            creatives.append(entry)
    if creatives:
        campaign_name = root.parent.name or "ExistingCampaign"
        return [{"name": campaign_name, "adsets": [{"name": root.name, "creatives": creatives}]}]

    # Otherwise, treat children as campaign folders.
    campaigns = []
    for campaign_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        adsets = _collect_adsets(campaign_dir)
        if adsets:
            campaigns.append({"name": campaign_dir.name, "adsets": adsets})

    if not campaigns:
        raise ValueError(f"No campaigns detected in {root}")
    return campaigns
