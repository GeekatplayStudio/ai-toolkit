from typing import OrderedDict, Union

from toolkit.config import get_config


def get_job(
        config_path: Union[str, dict, OrderedDict],
        name=None
):
    config = get_config(config_path, name)
    if not config['job']:
        raise ValueError('config file is invalid. Missing "job" key')

    job = config['job']
    if job == 'extract':
        from jobs import ExtractJob
        return ExtractJob(config)
    if job == 'train':
        from jobs import TrainJob
        return TrainJob(config)
    if job == 'mod':
        from jobs import ModJob
        return ModJob(config)
    if job == 'generate':
        from jobs import GenerateJob
        return GenerateJob(config)
    if job == 'extension':
        from jobs import ExtensionJob
        return ExtensionJob(config)

    # elif job == 'train':
    #     from jobs import TrainJob
    #     return TrainJob(config)
    else:
        raise ValueError(f'Unknown job type {job}')


def cleanup_job(job) -> bool:
    if job is None:
        return False

    cleanup = getattr(job, 'cleanup', None)
    if not callable(cleanup):
        return False

    cleanup()
    return True


def notify_job_error(job, error: BaseException) -> bool:
    if job is None:
        return False

    processes = getattr(job, 'process', None)
    if not processes:
        return False

    handler = getattr(processes[0], 'on_error', None)
    if not callable(handler):
        return False

    handler(error)
    return True


def run_job(
        config: Union[str, dict, OrderedDict],
        name=None
):
    job = None
    try:
        job = get_job(config, name)
        job.run()
    finally:
        cleanup_job(job)
