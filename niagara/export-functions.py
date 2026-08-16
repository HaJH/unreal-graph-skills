# Exports Niagara script assets to T3D, so the pin table can be generated offline.
#
# Run inside Unreal Editor (Output Log > Python, or any Python execution path):
#
#     exec(open(r'<plugin>/niagara/export-functions.py').read())
#
# A function call's pins are the called script's own input names, and those live in each
# asset rather than in one engine header -- so unlike the operator table, this half cannot be
# read off the source tree. Exporting the assets to text puts them in a format the generator
# already knows how to parse, and the editor is only needed for this step.
#
# Edit ROOTS and OUT_DIR below, run it, then run:
#     node niagara/generate-functions.mjs <OUT_DIR>
import os
import unreal

# Content roots to sweep. /Niagara is the engine plugin; add /Game paths for project scripts.
ROOTS = [
    '/Niagara/Functions',
    '/Niagara/DynamicInputs',
    '/Niagara/Modules',
]

OUT_DIR = r'C:\niagara-export'

registry = unreal.AssetRegistryHelpers.get_asset_registry()
exporter_ok = 0
skipped = 0

os.makedirs(OUT_DIR, exist_ok=True)

for root in ROOTS:
    assets = registry.get_assets_by_path(root, recursive=True)
    for data in assets:
        if str(data.asset_class_path.asset_name) != 'NiagaraScript':
            continue
        path = str(data.package_name)
        target = os.path.join(OUT_DIR, path.strip('/').replace('/', '__') + '.T3D')
        if os.path.exists(target):
            skipped += 1
            continue
        asset = unreal.load_asset(path)
        if asset is None:
            continue
        task = unreal.AssetExportTask()
        task.set_editor_property('object', asset)
        task.set_editor_property('filename', target)
        task.set_editor_property('automated', True)
        task.set_editor_property('replace_identical', True)
        task.set_editor_property('prompt', False)
        task.set_editor_property('write_empty_files', False)
        if unreal.Exporter.run_asset_export_task(task):
            exporter_ok += 1

print('exported %d, already present %d -> %s' % (exporter_ok, skipped, OUT_DIR))
