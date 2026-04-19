import os
import importlib
import pkgutil
from typing import List

from toolkit.paths import TOOLKIT_ROOT


class Extension(object):
    """Base class for extensions.

    Extensions are registered with the ExtensionManager, which is
    responsible for calling the extension's load() and unload()
    methods at the appropriate times.

    """

    name: str = None
    uid: str = None

    @classmethod
    def get_process(cls):
        # extend in subclass
        pass


def get_all_extensions() -> List[Extension]:
    extension_folders = ['extensions', 'extensions_built_in']

    # This will hold the classes from all extension modules
    all_extension_classes: List[Extension] = []

    # Iterate over all directories (i.e., packages) in the "extensions" directory
    for sub_dir in extension_folders:
        extensions_dir = os.path.join(TOOLKIT_ROOT, sub_dir)
        if not os.path.isdir(extensions_dir):
            continue

        for (_, name, _) in pkgutil.iter_modules([extensions_dir]):
            module_name = f"{sub_dir}.{name}"
            try:
                module = importlib.import_module(module_name)
            except Exception as error:
                print(f"Failed to import extension module {module_name}: {error}")
                continue

            extensions = getattr(module, "AI_TOOLKIT_EXTENSIONS", None)
            if extensions is None:
                continue
            if not isinstance(extensions, list):
                raise ValueError(f"{module_name}.AI_TOOLKIT_EXTENSIONS must be a list")

            all_extension_classes.extend(extensions)

    return all_extension_classes


def get_all_extensions_process_dict():
    all_extensions = get_all_extensions()
    process_dict = {}
    for extension in all_extensions:
        process_dict[extension.uid] = extension.get_process()
    return process_dict
