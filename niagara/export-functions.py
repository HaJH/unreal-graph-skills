# Exports the Niagara assets the offline generators read, as T3D.
#
# Run inside Unreal Editor (Output Log > Python, or any Python execution path):
#
#     exec(open(r'<plugin>/niagara/export-functions.py').read())
#
# Three tables are built from this one export, because all three live in assets rather than in
# an engine header and so cannot be read off the source tree:
#
#   scripts  ->  a function call's pins, and a module's stack inputs
#   enums    ->  the display name the stack shows for each enumerator
#
# Exporting to text puts them in a format the generators already parse, and the editor is only
# needed for this step. Edit ROOTS and OUT_DIR below, run it, then run:
#
#     node niagara/generate-functions.mjs <OUT_DIR>     # graph-side function-call pins
#     node niagara/generate-modules.mjs   <OUT_DIR>     # stack-side module inputs
#     node niagara/generate-enums.mjs     <OUT_DIR>     # enumerator display names
import os
import unreal

# Content roots to sweep, each paired with the asset class wanted from it. /Niagara is the
# engine plugin; add /Game paths for project scripts and project enums.
ROOTS = [
    ('/Niagara/Functions', 'NiagaraScript'),
    ('/Niagara/DynamicInputs', 'NiagaraScript'),
    ('/Niagara/Modules', 'NiagaraScript'),
    # A module input typed as an enum stores an ordinal; the names live over here.
    ('/Niagara/Enums', 'UserDefinedEnum'),
]

OUT_DIR = r'C:\niagara-export'

registry = unreal.AssetRegistryHelpers.get_asset_registry()
exporter_ok = 0
skipped = 0

os.makedirs(OUT_DIR, exist_ok=True)

for root, wanted_class in ROOTS:
    assets = registry.get_assets_by_path(root, recursive=True)
    for data in assets:
        if str(data.asset_class_path.asset_name) != wanted_class:
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
