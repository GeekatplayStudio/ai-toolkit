import os
import sys
import tempfile
import threading
import types
import unittest

from PIL import Image

fake_diffusers = types.ModuleType('diffusers')
fake_diffusers.AutoencoderTiny = object
sys.modules.setdefault('diffusers', fake_diffusers)

fake_buckets = types.ModuleType('toolkit.buckets')
fake_buckets.BucketResolution = object
fake_buckets.get_bucket_for_image_size = lambda *args, **kwargs: None
sys.modules.setdefault('toolkit.buckets', fake_buckets)

fake_config_modules = types.ModuleType('toolkit.config_modules')
fake_config_modules.DatasetConfig = object
fake_config_modules.preprocess_dataset_raw_config = lambda config, *args, **kwargs: config
sys.modules.setdefault('toolkit.config_modules', fake_config_modules)

fake_dataloader_mixins = types.ModuleType('toolkit.dataloader_mixins')

class _CaptionMixin:
    pass


class _BucketsMixin:
    pass


class _LatentCachingMixin:
    pass


class _CLIPCachingMixin:
    pass


class _ControlCachingMixin:
    pass


class _TextEmbeddingCachingMixin:
    pass


class _Augments:
    def __init__(self, *args, **kwargs):
        self.method_name = kwargs.get('method_name', '')
        self.params = kwargs.get('params', {})


fake_dataloader_mixins.CaptionMixin = _CaptionMixin
fake_dataloader_mixins.BucketsMixin = _BucketsMixin
fake_dataloader_mixins.LatentCachingMixin = _LatentCachingMixin
fake_dataloader_mixins.CLIPCachingMixin = _CLIPCachingMixin
fake_dataloader_mixins.ControlCachingMixin = _ControlCachingMixin
fake_dataloader_mixins.TextEmbeddingCachingMixin = _TextEmbeddingCachingMixin
fake_dataloader_mixins.Augments = _Augments
sys.modules.setdefault('toolkit.dataloader_mixins', fake_dataloader_mixins)

fake_data_transfer_object = types.ModuleType('toolkit.data_transfer_object')
fake_data_loader_dto = types.ModuleType('toolkit.data_transfer_object.data_loader')
fake_data_loader_dto.FileItemDTO = object
fake_data_loader_dto.DataLoaderBatchDTO = object
fake_data_transfer_object.data_loader = fake_data_loader_dto
sys.modules.setdefault('toolkit.data_transfer_object', fake_data_transfer_object)
sys.modules.setdefault('toolkit.data_transfer_object.data_loader', fake_data_loader_dto)

fake_print = types.ModuleType('toolkit.print')
fake_print.print_acc = lambda *args, **kwargs: None
sys.modules.setdefault('toolkit.print', fake_print)

fake_accelerator = types.ModuleType('toolkit.accelerator')
fake_accelerator.get_accelerator = lambda: None
sys.modules.setdefault('toolkit.accelerator', fake_accelerator)

from toolkit.data_loader import ImageDataset, SIZE_DATABASE_VERSION, load_size_database_file, merge_and_save_size_database


class ImageDatasetTest(unittest.TestCase):
    def create_image(self, directory: str, filename: str, size=(128, 128), color=(255, 0, 0)) -> str:
        path = os.path.join(directory, filename)
        Image.new('RGB', size, color).save(path)
        return path

    def create_corrupt_file(self, directory: str, filename: str) -> str:
        path = os.path.join(directory, filename)
        with open(path, 'wb') as handle:
            handle.write(b'not-a-real-image')
        return path

    def test_skips_unreadable_images_during_init(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            valid_image = self.create_image(temp_dir, 'valid.png')
            self.create_corrupt_file(temp_dir, 'broken.png')

            dataset = ImageDataset({'path': temp_dir, 'resolution': 64})

            self.assertEqual(len(dataset), 1)
            self.assertEqual(dataset.file_list, [valid_image])

    def test_raises_when_all_images_are_unreadable(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            self.create_corrupt_file(temp_dir, 'broken.png')

            with self.assertRaisesRegex(ValueError, 'no readable images found'):
                ImageDataset({'path': temp_dir, 'resolution': 64})

    def test_raises_clear_error_when_file_becomes_unreadable_after_init(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            valid_image = self.create_image(temp_dir, 'valid.png')
            dataset = ImageDataset({'path': temp_dir, 'resolution': 64})

            with open(valid_image, 'wb') as handle:
                handle.write(b'not-a-real-image-anymore')

            with self.assertRaisesRegex(RuntimeError, 'Failed to load training image'):
                dataset[0]

    def test_merge_and_save_size_database_preserves_existing_entries(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            size_db_path = os.path.join(temp_dir, '.aitk_size.json')
            with open(size_db_path, 'w', encoding='utf-8') as handle:
                handle.write('{"__version__": "0.1.2", "existing": [64, 64, "sig-a"]}')

            local_size_database = {
                '__version__': SIZE_DATABASE_VERSION,
                'new-entry': (128, 128, 'sig-b'),
            }

            merge_and_save_size_database(size_db_path, local_size_database, SIZE_DATABASE_VERSION)
            merged = load_size_database_file(size_db_path, SIZE_DATABASE_VERSION)

            self.assertEqual(merged['existing'], [64, 64, 'sig-a'])
            self.assertEqual(merged['new-entry'], [128, 128, 'sig-b'])
            self.assertEqual(local_size_database['existing'], [64, 64, 'sig-a'])

    def test_merge_and_save_size_database_concurrent_writes_preserve_updates(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            size_db_path = os.path.join(temp_dir, '.aitk_size.json')
            start_barrier = threading.Barrier(2)
            errors = []

            def worker(key, value):
                try:
                    local_size_database = {
                        '__version__': SIZE_DATABASE_VERSION,
                        key: value,
                    }
                    start_barrier.wait()
                    merge_and_save_size_database(size_db_path, local_size_database, SIZE_DATABASE_VERSION)
                except Exception as error:
                    errors.append(error)

            thread_a = threading.Thread(target=worker, args=('a', (64, 64, 'sig-a')))
            thread_b = threading.Thread(target=worker, args=('b', (128, 128, 'sig-b')))
            thread_a.start()
            thread_b.start()
            thread_a.join()
            thread_b.join()

            self.assertEqual(errors, [])
            merged = load_size_database_file(size_db_path, SIZE_DATABASE_VERSION)
            self.assertEqual(merged['a'], [64, 64, 'sig-a'])
            self.assertEqual(merged['b'], [128, 128, 'sig-b'])


if __name__ == '__main__':
    unittest.main()