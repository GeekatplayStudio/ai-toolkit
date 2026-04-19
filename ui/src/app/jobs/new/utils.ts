import { DatasetConfig, GpuInfo, JobConfig } from '@/types';
import { modelArchs, ModelArch } from './options';
import { objectCopy } from '@/utils/basic';
import { setNestedValue } from '@/utils/hooks';
import { defaultDatasetConfig, defaultJobConfig } from './jobConfig';

const expandDatasetDefaults = (
  defaults: { [key: string]: any },
  numDatasets: number,
): { [key: string]: any } => {
  // expands the defaults for datasets[x] to datasets[0], datasets[1], etc.
  const expandedDefaults: { [key: string]: any } = { ...defaults };
  for (const key in defaults) {
    if (key.includes('datasets[x].')) {
      for (let i = 0; i < numDatasets; i++) {
        const datasetKey = key.replace('datasets[x].', `datasets[${i}].`);
        const v = defaults[key];
        expandedDefaults[datasetKey] = Array.isArray(v) ? [...v] : objectCopy(v);
      }
      delete expandedDefaults[key];
    }
  }
  return expandedDefaults;
};

const clonePresetValue = <T>(value: T): T => {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value) || typeof value === 'object') {
    return objectCopy(value);
  }
  return value;
};

type LowVramRecommendationInfo = {
  recommendedLowVram: boolean;
  selectedGpuVramGiB: number;
  thresholdGiB: number;
};

const LOW_VRAM_THRESHOLD_BY_ARCH_GIB: Record<string, number> = {
  'wan21:14b': 24,
  'wan21_i2v:14b480p': 24,
  'wan21_i2v:14b': 24,
  'wan22_14b:t2v': 24,
  wan22_14b_i2v: 24,
  wan22_5b: 24,
  qwen_image: 24,
  'qwen_image:2512': 24,
  qwen_image_edit: 32,
  qwen_image_edit_plus: 32,
  'qwen_image_edit_plus:2511': 32,
  flux2: 24,
  flux2_klein_4b: 24,
  flux2_klein_9b: 24,
  'zimage:turbo': 24,
  zimage: 24,
  'zimage:deturbo': 24,
  ltx2: 24,
  'ltx2.3': 24,
  ace_step_15_xl: 24,
  ace_step_15: 24,
  nucleus_image: 24,
  ernie_image: 24,
  hidream: 48,
  hidream_e1: 48,
};

const parseSelectedGpuIds = (gpuIDs: string | null) => {
  if (!gpuIDs || gpuIDs === 'mps') {
    return [];
  }

  return gpuIDs
    .split(',')
    .map(value => Number.parseInt(value.trim(), 10))
    .filter(value => Number.isFinite(value));
};

export const getSelectedGpuVramGiB = (gpuIDs: string | null, gpuList: GpuInfo[]) => {
  const selectedGpuIds = parseSelectedGpuIds(gpuIDs);
  if (selectedGpuIds.length === 0 || gpuList.length === 0) {
    return null;
  }

  const selectedGpus = gpuList.filter(gpu => selectedGpuIds.includes(gpu.index));
  if (selectedGpus.length === 0) {
    return null;
  }

  return Math.min(...selectedGpus.map(gpu => gpu.memory.total / 1024));
};

export const getRecommendedLowVramInfo = (
  archName: string,
  gpuIDs: string | null,
  gpuList: GpuInfo[],
): LowVramRecommendationInfo | undefined => {
  const thresholdGiB = LOW_VRAM_THRESHOLD_BY_ARCH_GIB[archName];
  if (thresholdGiB === undefined) {
    return undefined;
  }

  const selectedGpuVramGiB = getSelectedGpuVramGiB(gpuIDs, gpuList);
  if (selectedGpuVramGiB === null) {
    return undefined;
  }

  return {
    recommendedLowVram: selectedGpuVramGiB <= thresholdGiB,
    selectedGpuVramGiB,
    thresholdGiB,
  };
};

export const getRecommendedLowVramSetting = (
  archName: string,
  gpuIDs: string | null,
  gpuList: GpuInfo[],
): boolean | undefined => {
  return getRecommendedLowVramInfo(archName, gpuIDs, gpuList)?.recommendedLowVram;
};

const applyArchDefaults = (jobConfig: JobConfig, arch: ModelArch): JobConfig => {
  const numDatasets = Math.max(jobConfig.config.process[0].datasets.length, 1);
  const defaults = expandDatasetDefaults(arch.defaults || {}, numDatasets);

  let nextJobConfig = jobConfig;
  for (const [key, value] of Object.entries(defaults)) {
    const selectedValue = Array.isArray(value) ? value[0] : value;
    nextJobConfig = setNestedValue(nextJobConfig, clonePresetValue(selectedValue), key);
  }

  return nextJobConfig;
};

const getRecommendedDatasetResolution = (
  arch: ModelArch,
  presetResolution?: number[],
  sampleWidth?: number,
  sampleHeight?: number,
) => {
  if (arch.group === 'audio') {
    return clonePresetValue(defaultDatasetConfig.resolution);
  }

  if (presetResolution && presetResolution.length > 0) {
    return clonePresetValue(presetResolution);
  }

  if (arch.name === 'sd15') {
    return [512];
  }

  if (arch.group === 'video') {
    return [768];
  }

  const width = sampleWidth ?? 1024;
  const height = sampleHeight ?? 1024;
  return [Math.max(width, height)];
};

const shouldPreserveSamplePrompts = (currentArch: ModelArch | undefined, newArch: ModelArch) => {
  if (!currentArch) {
    return newArch.group !== 'audio';
  }

  if (currentArch.group === 'audio' || newArch.group === 'audio') {
    return currentArch.group === newArch.group;
  }

  return true;
};

const buildPresetDatasets = (
  currentDatasets: DatasetConfig[],
  presetDatasets: DatasetConfig[],
  arch: ModelArch,
  sampleWidth?: number,
  sampleHeight?: number,
  sampleNumFrames?: number,
): DatasetConfig[] => {
  const supportsSingleControlPath = arch.additionalSections?.includes('datasets.control_path') || false;
  const supportsMultiControlPaths = arch.additionalSections?.includes('datasets.multi_control_paths') || false;
  const supportsNumFrames = arch.additionalSections?.includes('datasets.num_frames') || false;

  return presetDatasets.map((presetDataset, index) => {
    const currentDataset = currentDatasets[index];
    const nextDataset = objectCopy(presetDataset);
    const recommendedResolution = getRecommendedDatasetResolution(
      arch,
      presetDataset.resolution,
      sampleWidth,
      sampleHeight,
    );

    if (currentDataset) {
      nextDataset.folder_path = currentDataset.folder_path;
      nextDataset.mask_path = currentDataset.mask_path;
      nextDataset.mask_min_value = currentDataset.mask_min_value;
      nextDataset.default_caption = currentDataset.default_caption;
      nextDataset.caption_ext = currentDataset.caption_ext;
      nextDataset.caption_dropout_rate = currentDataset.caption_dropout_rate;
      nextDataset.is_reg = currentDataset.is_reg;
      nextDataset.network_weight = currentDataset.network_weight;
      nextDataset.flip_x = currentDataset.flip_x;
      nextDataset.flip_y = currentDataset.flip_y;
      nextDataset.num_repeats = currentDataset.num_repeats ?? nextDataset.num_repeats;

      if ('shuffle_tokens' in currentDataset) {
        nextDataset.shuffle_tokens = currentDataset.shuffle_tokens;
      }
    }

    nextDataset.controls = clonePresetValue(arch.controls || []);

    if (supportsMultiControlPaths) {
      nextDataset.control_path_1 = currentDataset?.control_path_1 ?? currentDataset?.control_path ?? null;
      nextDataset.control_path_2 = currentDataset?.control_path_2 ?? null;
      nextDataset.control_path_3 = currentDataset?.control_path_3 ?? null;
      delete nextDataset.control_path;
    } else if (supportsSingleControlPath) {
      nextDataset.control_path = currentDataset?.control_path ?? currentDataset?.control_path_1 ?? null;
      delete nextDataset.control_path_1;
      delete nextDataset.control_path_2;
      delete nextDataset.control_path_3;
    } else {
      delete nextDataset.control_path;
      delete nextDataset.control_path_1;
      delete nextDataset.control_path_2;
      delete nextDataset.control_path_3;
    }

    if (arch.group !== 'audio') {
      nextDataset.resolution = recommendedResolution;
    }

    if (supportsNumFrames) {
      if (!nextDataset.auto_frame_count) {
        nextDataset.num_frames = presetDataset.num_frames || sampleNumFrames || 1;
      }
    } else {
      nextDataset.num_frames = 1;
      delete nextDataset.auto_frame_count;
    }

    return nextDataset;
  });
};

const buildPresetSamples = (
  currentSamples: Array<Record<string, any>>,
  presetSamples: Array<Record<string, any>>,
  currentArch: ModelArch | undefined,
  newArch: ModelArch,
) => {
  const sampleCount = Math.max(currentSamples.length, presetSamples.length, 1);
  const basePresetSample = clonePresetValue(presetSamples[0] || { prompt: '' });
  const preservePrompts = shouldPreserveSamplePrompts(currentArch, newArch);
  const supportsSingleControlImage = newArch.additionalSections?.includes('sample.ctrl_img') || false;
  const supportsMultiControlImages = newArch.additionalSections?.includes('sample.multi_ctrl_imgs') || false;

  return Array.from({ length: sampleCount }, (_, index) => {
    const currentSample = currentSamples[index];
    const nextSample = clonePresetValue(presetSamples[index] || basePresetSample);

    if (preservePrompts && currentSample?.prompt?.trim()) {
      nextSample.prompt = currentSample.prompt;
    }

    if (supportsMultiControlImages) {
      nextSample.ctrl_img_1 = currentSample?.ctrl_img_1 ?? currentSample?.ctrl_img ?? null;
      nextSample.ctrl_img_2 = currentSample?.ctrl_img_2 ?? null;
      nextSample.ctrl_img_3 = currentSample?.ctrl_img_3 ?? null;
      delete nextSample.ctrl_img;
    } else if (supportsSingleControlImage) {
      nextSample.ctrl_img = currentSample?.ctrl_img ?? currentSample?.ctrl_img_1 ?? null;
      delete nextSample.ctrl_img_1;
      delete nextSample.ctrl_img_2;
      delete nextSample.ctrl_img_3;
    } else {
      delete nextSample.ctrl_img;
      delete nextSample.ctrl_img_1;
      delete nextSample.ctrl_img_2;
      delete nextSample.ctrl_img_3;
    }

    return nextSample;
  });
};

export const applyModelArchPreset = (
  jobConfig: JobConfig,
  newArchName: string,
  options: { force?: boolean; gpuIDs?: string | null; gpuList?: GpuInfo[] } = {},
) => {
  const currentArchName = jobConfig.config.process[0].model.arch;
  const currentArch = modelArchs.find(a => a.name === currentArchName);
  const newArch = modelArchs.find(model => model.name === newArchName);
  if (!newArch) {
    return jobConfig;
  }
  if (!options.force && currentArch?.name === newArchName) {
    return jobConfig;
  }

  const currentProcess = jobConfig.config.process[0];
  let nextJobConfig = objectCopy(jobConfig);
  nextJobConfig.config.process[0] = {
    ...nextJobConfig.config.process[0],
    network: clonePresetValue(defaultJobConfig.config.process[0].network),
    train: clonePresetValue(defaultJobConfig.config.process[0].train),
    model: clonePresetValue(defaultJobConfig.config.process[0].model),
    sample: clonePresetValue(defaultJobConfig.config.process[0].sample),
    datasets: Array.from({ length: Math.max(currentProcess.datasets.length, 1) }, () =>
      clonePresetValue(defaultDatasetConfig),
    ),
  };

  nextJobConfig.config.process[0].model.arch = newArchName;
  nextJobConfig = applyArchDefaults(nextJobConfig, newArch);

  if (newArch.additionalSections?.includes('model.layer_offloading')) {
    nextJobConfig.config.process[0].model.layer_offloading =
      nextJobConfig.config.process[0].model.layer_offloading || false;
    nextJobConfig.config.process[0].model.layer_offloading_text_encoder_percent =
      nextJobConfig.config.process[0].model.layer_offloading_text_encoder_percent ?? 1.0;
    nextJobConfig.config.process[0].model.layer_offloading_transformer_percent =
      nextJobConfig.config.process[0].model.layer_offloading_transformer_percent ?? 1.0;
  }

  nextJobConfig.config.process[0].datasets = buildPresetDatasets(
    currentProcess.datasets,
    nextJobConfig.config.process[0].datasets,
    newArch,
    nextJobConfig.config.process[0].sample.width,
    nextJobConfig.config.process[0].sample.height,
    nextJobConfig.config.process[0].sample.num_frames,
  );

  nextJobConfig.config.process[0].sample.samples = buildPresetSamples(
    currentProcess.sample.samples || [],
    nextJobConfig.config.process[0].sample.samples || [],
    currentArch,
    newArch,
  );

  const recommendedLowVram = getRecommendedLowVramSetting(newArchName, options.gpuIDs ?? null, options.gpuList ?? []);
  if (recommendedLowVram !== undefined) {
    nextJobConfig.config.process[0].model.low_vram = recommendedLowVram;
  }

  if (shouldPreserveSamplePrompts(currentArch, newArch)) {
    nextJobConfig.config.process[0].sample.neg = currentProcess.sample.neg;
  }

  return nextJobConfig;
};
