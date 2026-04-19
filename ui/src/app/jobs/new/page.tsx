'use client';

import { useMemo } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { defaultJobConfig, defaultDatasetConfig, migrateJobConfig } from './jobConfig';
import {
  buildDraftRestoreSummary,
  clearNewJobDraft,
  loadNewJobDraft,
  mergeDraftWithTemplate,
  saveNewJobDraft,
  summarizeDraftPaths,
} from './draftPersistence';
import { jobTypeOptions } from './options';
import { JobConfig } from '@/types';
import { objectCopy } from '@/utils/basic';
import { useNestedState, setNestedValue } from '@/utils/hooks';
import { Checkbox, SelectInput } from '@/components/formInputs';
import useSettings from '@/hooks/useSettings';
import useGPUInfo from '@/hooks/useGPUInfo';
import useDatasetList from '@/hooks/useDatasetList';
import YAML from 'yaml';
import path from 'path';
import { TopBar, MainContent } from '@/components/layout';
import { openConfirm } from '@/components/ConfirmModal';
import { Button } from '@headlessui/react';
import { FaChevronLeft } from 'react-icons/fa';
import SimpleJob from './SimpleJob';
import AdvancedJob from './AdvancedJob';
import ErrorBoundary from '@/components/ErrorBoundary';
import { apiClient } from '@/utils/api';

const isDev = process.env.NODE_ENV === 'development';

export default function TrainingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const runId = searchParams.get('id');
  const cloneId = searchParams.get('cloneId');
  const [gpuIDs, setGpuIDs] = useState<string | null>(null);
  const { settings, isSettingsLoaded } = useSettings();
  const { gpuList, isGPUInfoLoaded } = useGPUInfo();
  const { datasets, status: datasetFetchStatus } = useDatasetList();
  const [datasetOptions, setDatasetOptions] = useState<{ value: string; label: string }[]>([]);
  const [showAdvancedView, setShowAdvancedView] = useState(false);
  const [preserveSettings, setPreserveSettings] = useState(false);
  const [isDraftBootstrapped, setIsDraftBootstrapped] = useState(false);

  const [jobConfig, setJobConfig] = useNestedState<JobConfig>(migrateJobConfig(objectCopy(defaultJobConfig)));
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDraftEligible = !runId;

  const buildTemplateJobConfig = useMemo(() => {
    return () => {
      let template = migrateJobConfig(objectCopy(defaultJobConfig));
      if (isSettingsLoaded && settings.TRAINING_FOLDER) {
        template = setNestedValue(template, settings.TRAINING_FOLDER, 'config.process[0].training_folder');
      }
      if (datasetOptions.length > 0) {
        for (let i = 0; i < template.config.process[0].datasets.length; i++) {
          if (template.config.process[0].datasets[i].folder_path === defaultDatasetConfig.folder_path) {
            template = setNestedValue(
              template,
              datasetOptions[0].value,
              `config.process[0].datasets[${i}].folder_path`,
            );
          }
        }
      }
      return template;
    };
  }, [datasetOptions, isSettingsLoaded, settings.TRAINING_FOLDER]);

  const sanitizeDraftJobConfig = (draftConfig: JobConfig) => {
    const sanitizedConfig = migrateJobConfig(objectCopy(draftConfig));

    if (sanitizedConfig.config.process[0].training_folder === defaultJobConfig.config.process[0].training_folder) {
      sanitizedConfig.config.process[0].training_folder = buildTemplateJobConfig().config.process[0].training_folder;
    }

    sanitizedConfig.config.process[0].datasets = sanitizedConfig.config.process[0].datasets.map(dataset => {
      if (dataset.folder_path !== defaultDatasetConfig.folder_path) {
        return dataset;
      }

      return {
        ...dataset,
        folder_path: datasetOptions[0]?.value || dataset.folder_path,
      };
    });

    return sanitizedConfig;
  };

  const handleImportConfig = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        let parsed: any;
        if (file.name.endsWith('.json') || file.name.endsWith('.jsonc')) {
          parsed = JSON.parse(text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
        } else {
          parsed = YAML.parse(text);
        }

        // Set required fields (same pattern as AdvancedJob.handleChange)
        try {
          parsed.config.process[0].sqlite_db_path = './aitk_db.db';
          parsed.config.process[0].training_folder = settings.TRAINING_FOLDER;
          parsed.config.process[0].device = 'cuda';
          parsed.config.process[0].performance_log_every = 10;
        } catch (err) {
          console.warn('Could not set required fields on imported config:', err);
        }

        migrateJobConfig(parsed);
        setJobConfig(parsed);
      } catch (err) {
        console.error('Failed to parse config file:', err);
        alert('Failed to parse config file. Please check the file format.');
      }
    };
    reader.readAsText(file);

    // Reset so the same file can be re-imported
    e.target.value = '';
  };

  useEffect(() => {
    if (!isSettingsLoaded) return;
    if (datasetFetchStatus !== 'success') return;

    const datasetOptions = datasets.map(name => ({ value: path.join(settings.DATASETS_FOLDER, name), label: name }));
    setDatasetOptions(datasetOptions);

    if (datasetOptions.length > 0) {
      const defaultDatasetPath = defaultDatasetConfig.folder_path;
      // Use functional updater so we check the *current* state, not a stale closure
      setJobConfig((prev: JobConfig) => {
        let updated = prev;
        for (let i = 0; i < prev.config.process[0].datasets.length; i++) {
          if (prev.config.process[0].datasets[i].folder_path === defaultDatasetPath) {
            updated = setNestedValue(updated, datasetOptions[0].value, `config.process[0].datasets[${i}].folder_path`);
          }
        }
        return updated;
      });
    }
  }, [datasets, settings, isSettingsLoaded, datasetFetchStatus]);

  // clone existing job
  useEffect(() => {
    if (cloneId) {
      apiClient
        .get(`/api/jobs?id=${cloneId}`)
        .then(res => res.data)
        .then(data => {
          console.log('Clone Training:', data);
          setGpuIDs(data.gpu_ids);
          const newJobConfig = migrateJobConfig(JSON.parse(data.job_config));
          newJobConfig.config.name = `${newJobConfig.config.name}_copy`;
          setJobConfig(newJobConfig);
        })
        .catch(error => console.error('Error fetching training:', error));
    }
  }, [cloneId]);

  useEffect(() => {
    if (runId) {
      apiClient
        .get(`/api/jobs?id=${runId}`)
        .then(res => res.data)
        .then(data => {
          console.log('Training:', data);
          setGpuIDs(data.gpu_ids);
          setJobConfig(migrateJobConfig(JSON.parse(data.job_config)));
        })
        .catch(error => console.error('Error fetching training:', error));
    }
  }, [runId]);

  useEffect(() => {
    if (isGPUInfoLoaded) {
      if (gpuIDs === null && gpuList.length > 0) {
        setGpuIDs(`${gpuList[0].index}`);
      }
    }
  }, [gpuList, isGPUInfoLoaded]);

  useEffect(() => {
    if (!isSettingsLoaded) return;

    setJobConfig((prevConfig: JobConfig) => {
      const trainingFolder = prevConfig.config.process[0].training_folder;
      if (trainingFolder && trainingFolder !== defaultJobConfig.config.process[0].training_folder) {
        return prevConfig;
      }

      return setNestedValue(prevConfig, settings.TRAINING_FOLDER, 'config.process[0].training_folder');
    });
  }, [settings, isSettingsLoaded, setJobConfig]);

  useEffect(() => {
    if (isDraftBootstrapped) {
      return;
    }

    if (!isDraftEligible) {
      setIsDraftBootstrapped(true);
      return;
    }

    if (!isSettingsLoaded || !isGPUInfoLoaded || datasetFetchStatus !== 'success') {
      return;
    }

    const savedDraft = loadNewJobDraft();
    if (savedDraft?.preserveSettings && !cloneId) {
      const sanitizedDraftConfig = sanitizeDraftJobConfig(savedDraft.jobConfig);
      const restoredJobConfig = mergeDraftWithTemplate(buildTemplateJobConfig(), sanitizedDraftConfig);
      const restoreSummary = buildDraftRestoreSummary(
        {
          ...savedDraft,
          jobConfig: sanitizedDraftConfig,
        },
        restoredJobConfig,
      );

      setPreserveSettings(true);
      setShowAdvancedView(savedDraft.showAdvancedView);
      setGpuIDs(savedDraft.gpuIDs ?? null);
      setJobConfig(restoredJobConfig);

      if (restoreSummary.versionChanged || restoreSummary.addedPaths.length > 0 || restoreSummary.droppedPaths.length > 0) {
        const addedPaths = summarizeDraftPaths(restoreSummary.addedPaths);
        const droppedPaths = summarizeDraftPaths(restoreSummary.droppedPaths);

        openConfirm({
          title: 'Saved settings restored',
          type: 'info',
          confirmText: 'OK',
          hideCancel: true,
          message: (
            <div className="space-y-3">
              <p>AI Toolkit restored your saved New Job settings with the latest schema. Verify the form before saving.</p>
              {addedPaths.length > 0 && (
                <div>
                  <div className="font-semibold text-blue-300">Added new defaults</div>
                  <ul className="mt-1 list-disc pl-5 space-y-1">
                    {addedPaths.map(pathItem => (
                      <li key={pathItem}>{pathItem}</li>
                    ))}
                  </ul>
                </div>
              )}
              {droppedPaths.length > 0 && (
                <div>
                  <div className="font-semibold text-blue-300">Removed outdated settings</div>
                  <ul className="mt-1 list-disc pl-5 space-y-1">
                    {droppedPaths.map(pathItem => (
                      <li key={pathItem}>{pathItem}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ),
        });
      }
    }

    setIsDraftBootstrapped(true);
  }, [
    buildTemplateJobConfig,
    cloneId,
    datasetFetchStatus,
    datasetOptions,
    isDraftBootstrapped,
    isDraftEligible,
    isGPUInfoLoaded,
    isSettingsLoaded,
    setJobConfig,
  ]);

  useEffect(() => {
    if (!isDraftEligible || !isDraftBootstrapped) {
      return;
    }

    if (!preserveSettings) {
      clearNewJobDraft();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      saveNewJobDraft({
        preserveSettings: true,
        gpuIDs,
        showAdvancedView,
        jobConfig,
      });
    }, 150);

    return () => window.clearTimeout(timeoutId);
  }, [gpuIDs, isDraftBootstrapped, isDraftEligible, jobConfig, preserveSettings, showAdvancedView]);

  const saveJob = async () => {
    if (status === 'saving') return;
    setStatus('saving');

    apiClient
      .post('/api/jobs', {
        id: runId,
        name: jobConfig.config.name,
        gpu_ids: gpuIDs,
        job_config: jobConfig,
      })
      .then(res => {
        setStatus('success');
        if (runId) {
          router.push(`/jobs/${runId}`);
        } else {
          router.push(`/jobs/${res.data.id}`);
        }
      })
      .catch(error => {
        if (error.response?.status === 409) {
          alert('Training name already exists. Please choose a different name.');
        } else {
          alert('Failed to save job. Please try again.');
        }
        console.log('Error saving training:', error);
      })
      .finally(() =>
        setTimeout(() => {
          setStatus('idle');
        }, 2000),
      );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    saveJob();
  };

  return (
    <>
      <TopBar>
        <div>
          <Button className="text-gray-500 dark:text-gray-300 px-3 mt-1" onClick={() => history.back()}>
            <FaChevronLeft />
          </Button>
        </div>
        <div>
          <h1 className="text-lg">{runId ? 'Edit Training Job' : 'New Training Job'}</h1>
        </div>
        <div className="flex-1"></div>
        {showAdvancedView && (
          <>
            <div>
              <SelectInput
                value={`${gpuIDs}`}
                onChange={value => setGpuIDs(value)}
                options={gpuList.map((gpu: any) => ({ value: `${gpu.index}`, label: `GPU #${gpu.index}` }))}
              />
            </div>
            <div className="mx-4 bg-gray-200 dark:bg-gray-800 w-1 h-6"></div>
            <div>
              <Button className="text-gray-200 bg-gray-800 px-3 py-1 rounded-md" onClick={handleImportConfig}>
                Import Config
              </Button>
            </div>
            <div className="mx-4 bg-gray-200 dark:bg-gray-800 w-1 h-6"></div>
          </>
        )}
        {!showAdvancedView && (
          <>
            <div>
              <SelectInput
                value={`${jobConfig?.config.process[0].type}`}
                onChange={value => {
                  // undo current job type changes
                  const currentOption = jobTypeOptions.find(
                    option => option.value === jobConfig?.config.process[0].type,
                  );
                  if (currentOption && currentOption.onDeactivate) {
                    setJobConfig(currentOption.onDeactivate(objectCopy(jobConfig)));
                  }
                  const option = jobTypeOptions.find(option => option.value === value);
                  if (option) {
                    if (option.onActivate) {
                      setJobConfig(option.onActivate(objectCopy(jobConfig)));
                    }
                    jobTypeOptions.forEach(opt => {
                      if (opt.value !== option.value && opt.onDeactivate) {
                        setJobConfig(opt.onDeactivate(objectCopy(jobConfig)));
                      }
                    });
                  }
                  setJobConfig(value, 'config.process[0].type');
                }}
                options={jobTypeOptions}
              />
            </div>
            <div className="mx-4 bg-gray-200 dark:bg-gray-800 w-1 h-6"></div>
          </>
        )}

        <div className="pr-2">
          {isDraftEligible && (
            <Checkbox
              label="Preserve settings"
              checked={preserveSettings}
              onChange={setPreserveSettings}
              className="pr-4"
            />
          )}
        </div>
        <div className="pr-2">
          <Button
            className="text-gray-200 bg-gray-800 px-3 py-1 rounded-md"
            onClick={() => setShowAdvancedView(!showAdvancedView)}
          >
            {showAdvancedView ? 'Show Simple' : 'Show Advanced'}
          </Button>
        </div>
        <div>
          <Button
            className="text-white bg-green-600 hover:bg-green-700 px-3 py-1 rounded-md"
            onClick={() => saveJob()}
            disabled={status === 'saving'}
          >
            {status === 'saving' ? 'Saving...' : runId ? 'Update Job' : 'Create Job'}
          </Button>
        </div>
      </TopBar>

      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,.json,.jsonc"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      {showAdvancedView ? (
        <div className="pt-[48px] absolute top-0 left-0 w-full h-full overflow-auto">
          <AdvancedJob
            jobConfig={jobConfig}
            setJobConfig={setJobConfig}
            status={status}
            handleSubmit={handleSubmit}
            runId={runId}
            gpuIDs={gpuIDs}
            setGpuIDs={setGpuIDs}
            gpuList={gpuList}
            datasetOptions={datasetOptions}
            settings={settings}
          />
        </div>
      ) : (
        <MainContent>
          <ErrorBoundary
            fallback={
              <div className="flex items-center justify-center h-64 text-lg text-red-600 font-medium bg-red-100 dark:bg-red-900/20 dark:text-red-400 border border-red-300 dark:border-red-700 rounded-lg">
                Advanced job detected. Please switch to advanced view to continue.
              </div>
            }
          >
            <SimpleJob
              jobConfig={jobConfig}
              setJobConfig={setJobConfig}
              status={status}
              handleSubmit={handleSubmit}
              runId={runId}
              gpuIDs={gpuIDs}
              setGpuIDs={setGpuIDs}
              gpuList={gpuList}
              datasetOptions={datasetOptions}
              isLoading={!isSettingsLoaded || !isGPUInfoLoaded || datasetFetchStatus !== 'success'}
            />
          </ErrorBoundary>

          <div className="pt-20"></div>
        </MainContent>
      )}
    </>
  );
}
