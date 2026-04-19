import { JobConfig } from '@/types';
import { objectCopy } from '@/utils/basic';

export interface NewJobDraft {
  version: number;
  schemaVersion: string;
  savedAt: string;
  preserveSettings: boolean;
  gpuIDs: string | null;
  showAdvancedView: boolean;
  jobConfig: JobConfig;
}

export interface DraftRestoreSummary {
  versionChanged: boolean;
  addedPaths: string[];
  droppedPaths: string[];
}

export const NEW_JOB_DRAFT_STORAGE_KEY = 'ai-toolkit:new-job-draft';
export const NEW_JOB_DRAFT_VERSION = 1;
export const NEW_JOB_SCHEMA_VERSION = '2026-04-19';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const loadNewJobDraft = (): NewJobDraft | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(NEW_JOB_DRAFT_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue) as Partial<NewJobDraft>;
    if (!parsedValue || !parsedValue.jobConfig) {
      return null;
    }

    return {
      version: parsedValue.version ?? 0,
      schemaVersion: parsedValue.schemaVersion ?? '',
      savedAt: parsedValue.savedAt ?? '',
      preserveSettings: Boolean(parsedValue.preserveSettings),
      gpuIDs: parsedValue.gpuIDs ?? null,
      showAdvancedView: Boolean(parsedValue.showAdvancedView),
      jobConfig: parsedValue.jobConfig,
    };
  } catch (error) {
    console.warn('Failed to load new job draft:', error);
    return null;
  }
};

export const saveNewJobDraft = (draft: Omit<NewJobDraft, 'version' | 'schemaVersion' | 'savedAt'>) => {
  if (typeof window === 'undefined') {
    return;
  }

  const draftToSave: NewJobDraft = {
    ...draft,
    version: NEW_JOB_DRAFT_VERSION,
    schemaVersion: NEW_JOB_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
  };

  window.localStorage.setItem(NEW_JOB_DRAFT_STORAGE_KEY, JSON.stringify(draftToSave));
};

export const clearNewJobDraft = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(NEW_JOB_DRAFT_STORAGE_KEY);
};

export const mergeDraftWithTemplate = <T>(template: T, draft: unknown): T => {
  if (Array.isArray(template)) {
    if (!Array.isArray(draft)) {
      return objectCopy(template);
    }

    const arrayTemplate = template as unknown[];
    const templateItem = arrayTemplate[0];
    return draft.map((item, index) => {
      const currentTemplate = arrayTemplate[index] ?? templateItem;
      if (currentTemplate === undefined) {
        return objectCopy(item);
      }
      return mergeDraftWithTemplate(currentTemplate, item);
    }) as T;
  }

  if (isPlainObject(template)) {
    const result: Record<string, unknown> = {};
    const draftObject = isPlainObject(draft) ? draft : {};
    for (const key of Object.keys(template)) {
      result[key] = mergeDraftWithTemplate(
        (template as Record<string, unknown>)[key],
        draftObject[key],
      );
    }
    return result as T;
  }

  if (draft === undefined) {
    return template;
  }

  return draft as T;
};

export const collectLeafPaths = (value: unknown, prefix = ''): string[] => {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return prefix ? [prefix] : [];
    }
    return value.flatMap((item, index) => collectLeafPaths(item, `${prefix}[${index}]`));
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return prefix ? [prefix] : [];
    }

    return entries.flatMap(([key, entryValue]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      return collectLeafPaths(entryValue, nextPrefix);
    });
  }

  return prefix ? [prefix] : [];
};

export const normalizeDraftPath = (path: string): string => {
  return path.replace(/^config\.process\[0\]\./, '').replace(/^config\./, '');
};

export const summarizeDraftPaths = (paths: string[], maxItems = 6): string[] => {
  const normalizedPaths = Array.from(new Set(paths.map(normalizeDraftPath))).sort();
  if (normalizedPaths.length <= maxItems) {
    return normalizedPaths;
  }

  return [...normalizedPaths.slice(0, maxItems), `+${normalizedPaths.length - maxItems} more`];
};

export const buildDraftRestoreSummary = (
  draft: NewJobDraft,
  restoredJobConfig: JobConfig,
): DraftRestoreSummary => {
  const draftPathSet = new Set(collectLeafPaths(draft.jobConfig));
  const restoredPathSet = new Set(collectLeafPaths(restoredJobConfig));

  const addedPaths = Array.from(restoredPathSet).filter(path => !draftPathSet.has(path));
  const droppedPaths = Array.from(draftPathSet).filter(path => !restoredPathSet.has(path));

  return {
    versionChanged:
      draft.version !== NEW_JOB_DRAFT_VERSION || draft.schemaVersion !== NEW_JOB_SCHEMA_VERSION,
    addedPaths,
    droppedPaths,
  };
};