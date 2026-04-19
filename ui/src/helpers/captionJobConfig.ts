import { GpuInfo, CaptionJobConfig } from '@/types';
import { objectCopy } from '@/utils/basic';
import { setNestedValue } from '@/utils/hooks';
import { getSelectedGpuVramGiB } from '@/app/jobs/new/utils';
import { captionerTypes } from './captionOptions';


export const defaultCaptionJobConfig: CaptionJobConfig = {
  job: 'extension',
  config: {
    name: 'Caption Directory',
    process: [
      {
        type: 'AceStepCaptioner',
        sqlite_db_path: './aitk_db.db',
        device: 'cuda',
        caption: {
          model_name_or_path: "ACE-Step/acestep-transcriber",
          model_name_or_path2: "ACE-Step/acestep-captioner",
          dtype: 'bf16',
          quantize: true,
          qtype: 'float8',
          low_vram: true,
          extensions: ['mp3', 'wav', 'flac', 'ogg'],
          path_to_caption: '',
          recaption: false,
        },
      },
    ],
  },
};

const CAPTION_LOW_VRAM_THRESHOLD_BY_TYPE_GIB: Record<string, number> = {
  AceStepCaptioner: 24,
  Qwen3VLCaptioner: 24,
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


const repairDefaults = (defaults: { [key: string]: any }) => {
  let newDefaults: { [key: string]: any } = {};
  // if the key doesnt start with config.process[0]., then add it
  for (const key in defaults) {
    if (!key.startsWith('config.process[0].')) {
      newDefaults[`config.process[0].${key}`] = defaults[key];
    } else {
      newDefaults[key] = defaults[key];
    }
  }
  return newDefaults;
}

export const getRecommendedCaptionLowVramInfo = (
  captionerTypeName: string,
  gpuIDs: string | null,
  gpuList: GpuInfo[],
) => {
  const thresholdGiB = CAPTION_LOW_VRAM_THRESHOLD_BY_TYPE_GIB[captionerTypeName];
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

export const getRecommendedCaptionLowVramSetting = (
  captionerTypeName: string,
  gpuIDs: string | null,
  gpuList: GpuInfo[],
) => {
  return getRecommendedCaptionLowVramInfo(captionerTypeName, gpuIDs, gpuList)?.recommendedLowVram;
};

export const applyCaptionerTypePreset = (
  jobConfig: CaptionJobConfig,
  newTypeName: string,
  options: { force?: boolean; gpuIDs?: string | null; gpuList?: GpuInfo[] } = {},
) => {
  const currentTypeName = jobConfig.config.process[0].type;
  const newType = captionerTypes.find(model => model.name === newTypeName);

  if (!newType) {
    return jobConfig;
  }

  if (!options.force && currentTypeName === newTypeName) {
    return jobConfig;
  }

  let nextJobConfig = objectCopy(defaultCaptionJobConfig);
  nextJobConfig.config.process[0].type = newTypeName;
  nextJobConfig.config.process[0].caption.path_to_caption = jobConfig.config.process[0].caption.path_to_caption;
  nextJobConfig.config.process[0].caption.recaption = jobConfig.config.process[0].caption.recaption;

  const newDefaults = repairDefaults(newType.defaults || {});
  for (const [key, value] of Object.entries(newDefaults)) {
    const selectedValue = Array.isArray(value) ? value[0] : value;
    nextJobConfig = setNestedValue(nextJobConfig, clonePresetValue(selectedValue), key);
  }

  const recommendedLowVram = getRecommendedCaptionLowVramSetting(
    newTypeName,
    options.gpuIDs ?? null,
    options.gpuList ?? [],
  );
  if (recommendedLowVram !== undefined) {
    nextJobConfig.config.process[0].caption.low_vram = recommendedLowVram;
  }

  return nextJobConfig;
}



export const handleCaptionerTypeChange = (
  currentTypeName: string,
  newTypeName: string,
  jobConfig: CaptionJobConfig,
  setJobConfig: (value: any, key: string) => void,
) => {
  if (currentTypeName === newTypeName) {
    return;
  }

  setJobConfig(applyCaptionerTypePreset(jobConfig, newTypeName));
};
