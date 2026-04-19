import types
import unittest
from unittest.mock import patch

from toolkit.extension import get_all_extensions


class ExtensionLoaderTest(unittest.TestCase):
    def test_get_all_extensions_continues_after_import_failure(self):
        good_extension = type('GoodExtension', (), {'uid': 'good'})
        built_in_extension = type('BuiltInExtension', (), {'uid': 'builtin'})

        def fake_iter_modules(paths):
            directory = paths[0]
            if directory.endswith('extensions'):
                return iter([(None, 'good', False), (None, 'broken', False)])
            if directory.endswith('extensions_built_in'):
                return iter([(None, 'builtin', False)])
            return iter([])

        def fake_import_module(module_name):
            if module_name == 'extensions.good':
                return types.SimpleNamespace(AI_TOOLKIT_EXTENSIONS=[good_extension])
            if module_name == 'extensions.broken':
                raise ImportError('boom')
            if module_name == 'extensions_built_in.builtin':
                return types.SimpleNamespace(AI_TOOLKIT_EXTENSIONS=[built_in_extension])
            raise AssertionError(f'Unexpected module import: {module_name}')

        with patch('builtins.print') as print_mock:
            with patch('toolkit.extension.os.path.isdir', return_value=True), patch(
                'toolkit.extension.pkgutil.iter_modules', side_effect=fake_iter_modules
            ), patch('toolkit.extension.importlib.import_module', side_effect=fake_import_module):
                extensions = get_all_extensions()

        self.assertEqual(extensions, [good_extension, built_in_extension])
        print_mock.assert_called_once()
        self.assertIn('extensions.broken', print_mock.call_args[0][0])

    def test_get_all_extensions_requires_list_metadata(self):
        def fake_iter_modules(paths):
            return iter([(None, 'badmeta', False)])

        with patch('toolkit.extension.os.path.isdir', return_value=True), patch(
            'toolkit.extension.pkgutil.iter_modules', side_effect=fake_iter_modules
        ), patch(
            'toolkit.extension.importlib.import_module',
            return_value=types.SimpleNamespace(AI_TOOLKIT_EXTENSIONS='not-a-list'),
        ):
            with self.assertRaisesRegex(ValueError, 'AI_TOOLKIT_EXTENSIONS must be a list'):
                get_all_extensions()


if __name__ == '__main__':
    unittest.main()