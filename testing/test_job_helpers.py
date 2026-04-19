import unittest
from collections import OrderedDict
from unittest.mock import patch

from toolkit.job import cleanup_job, notify_job_error, run_job


class FakeProcess:
    def __init__(self):
        self.errors = []

    def on_error(self, error):
        self.errors.append(error)


class FakeJob:
    def __init__(self, run_error=None):
        self.run_error = run_error
        self.run_calls = 0
        self.cleanup_calls = 0
        self.process = [FakeProcess()]

    def run(self):
        self.run_calls += 1
        if self.run_error is not None:
            raise self.run_error

    def cleanup(self):
        self.cleanup_calls += 1


class JobHelpersTest(unittest.TestCase):
    def test_cleanup_job_ignores_none(self):
        self.assertFalse(cleanup_job(None))

    def test_cleanup_job_calls_cleanup(self):
        job = FakeJob()

        cleaned = cleanup_job(job)

        self.assertTrue(cleaned)
        self.assertEqual(job.cleanup_calls, 1)

    def test_notify_job_error_uses_first_process(self):
        job = FakeJob()
        error = RuntimeError('boom')

        handled = notify_job_error(job, error)

        self.assertTrue(handled)
        self.assertEqual(job.process[0].errors, [error])

    def test_notify_job_error_handles_missing_processes(self):
        job = type('NoProcessJob', (), {'process': []})()

        handled = notify_job_error(job, RuntimeError('boom'))

        self.assertFalse(handled)

    def test_run_job_cleans_up_after_success(self):
        job = FakeJob()

        with patch('toolkit.job.get_job', return_value=job):
            run_job(OrderedDict({'job': 'train', 'config': {'name': 'demo'}}))

        self.assertEqual(job.run_calls, 1)
        self.assertEqual(job.cleanup_calls, 1)

    def test_run_job_cleans_up_after_failure(self):
        job = FakeJob(run_error=RuntimeError('boom'))

        with patch('toolkit.job.get_job', return_value=job):
            with self.assertRaises(RuntimeError):
                run_job(OrderedDict({'job': 'train', 'config': {'name': 'demo'}}))

        self.assertEqual(job.run_calls, 1)
        self.assertEqual(job.cleanup_calls, 1)

    def test_run_job_does_not_cleanup_when_get_job_fails(self):
        with patch('toolkit.job.get_job', side_effect=ValueError('missing config')):
            with self.assertRaises(ValueError):
                run_job(OrderedDict({'job': 'train', 'config': {'name': 'demo'}}))


if __name__ == '__main__':
    unittest.main()