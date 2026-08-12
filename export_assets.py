import joblib
import json
import pandas as pd
from pathlib import Path

base = Path("backend/assets")
model_path = base / "roadsafe_uk_severity_champion.joblib"
grid_path = base / "historical_grid.csv.gz"

m = joblib.load(model_path)
clf = m.named_steps['model']

def export_tree(nodes):
    res = []
    for n in nodes:
        res.append({
            'v': round(float(n['value']), 6),
            'f': int(n['feature_idx']),
            't': round(float(n['num_threshold']), 6),
            'm': bool(n['missing_go_to_left']),
            'l': int(n['left']),
            'r': int(n['right']),
            'leaf': bool(n['is_leaf'])
        })
    return res

trees_data = []
for it in clf._predictors:
    trees_data.append([export_tree(t.nodes) for t in it])

model_json = {
    'baseline': [round(float(b), 6) for b in clf._baseline_prediction[0]],
    'classes': [int(c) for c in clf.classes_],
    'trees': trees_data
}

target_dir = Path("frontend/app/api/predict/assets")
target_dir.mkdir(parents=True, exist_ok=True)

with open(target_dir / "model_assets.json", "w") as f:
    json.dump(model_json, f)

grid = pd.read_csv(grid_path)
grid_list = []
for _, r in grid.iterrows():
    grid_list.append([
        round(float(r['lat_grid']), 2),
        round(float(r['lon_grid']), 2),
        int(r['collision_count']),
        int(r['fatal_count']),
        int(r['serious_count']),
        int(r['slight_count']),
        round(float(r['rain_share']), 4),
        round(float(r['rush_share']), 4),
        round(float(r['night_share']), 4),
        round(float(r['hotspot_percentile']), 2)
    ])

with open(target_dir / "historical_grid.json", "w") as f:
    json.dump(grid_list, f)

print("Export complete!")
