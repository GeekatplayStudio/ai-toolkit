const SHOT_VARIATIONS = [
  'tight portrait framing',
  'full body composition',
  'three quarter view',
  'wide cinematic framing',
  'close up detail shot',
  'editorial fashion framing',
];

const LIGHTING_VARIATIONS = [
  'soft morning light',
  'golden hour lighting',
  'dramatic studio lighting',
  'neon rim lighting',
  'overcast natural light',
  'high contrast flash photography',
];

const MOOD_VARIATIONS = [
  'calm mood',
  'confident mood',
  'playful mood',
  'moody atmosphere',
  'dreamlike atmosphere',
  'high energy vibe',
];

const SCENE_VARIATIONS = [
  'high detail background',
  'clean environmental storytelling',
  'rich texture detail',
  'shallow depth of field',
  'polished color grading',
  'crisp focus on the subject',
];

const STYLE_VARIATIONS = [
  'photorealistic detail',
  'cinematic color palette',
  'editorial photography style',
  'premium commercial look',
  'film still aesthetic',
  'high end fashion photography',
];

const uniqueParts = (parts: string[]) => {
  const seen = new Set<string>();
  const normalizedParts: string[] = [];

  for (const part of parts) {
    const trimmedPart = part.trim();
    if (!trimmedPart) {
      continue;
    }

    const key = trimmedPart.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalizedParts.push(trimmedPart);
  }

  return normalizedParts;
};

const splitPrompt = (prompt: string) => {
  return prompt
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
};

const withTriggerWord = (prompt: string, triggerWord?: string | null) => {
  const cleanedPrompt = prompt.replace(/\[trigger\]/gi, '').replace(/\s+,/g, ',').trim();
  const cleanedTriggerWord = triggerWord?.trim();

  if (!cleanedTriggerWord) {
    return cleanedPrompt;
  }

  if (/\[trigger\]/i.test(prompt)) {
    return prompt.replace(/\[trigger\]/gi, cleanedTriggerWord).trim();
  }

  if (cleanedPrompt.toLowerCase().includes(cleanedTriggerWord.toLowerCase())) {
    return cleanedPrompt;
  }

  if (!cleanedPrompt) {
    return cleanedTriggerWord;
  }

  return `${cleanedTriggerWord}, ${cleanedPrompt}`;
};

export const generatePromptVariations = ({
  basePrompt,
  triggerWord,
  count,
}: {
  basePrompt: string;
  triggerWord?: string | null;
  count: number;
}): string[] => {
  const safeCount = Math.max(1, Math.min(50, Math.floor(count || 1)));
  const promptWithTrigger = withTriggerWord(basePrompt.trim(), triggerWord);
  const baseParts = uniqueParts(splitPrompt(promptWithTrigger));

  if (baseParts.length === 0) {
    return [];
  }

  const promptSet = new Set<string>();
  promptSet.add(baseParts.join(', '));

  let iteration = 0;
  while (promptSet.size < safeCount && iteration < safeCount * 10) {
    const variantParts = uniqueParts([
      ...baseParts,
      SHOT_VARIATIONS[iteration % SHOT_VARIATIONS.length],
      LIGHTING_VARIATIONS[Math.floor(iteration / SHOT_VARIATIONS.length) % LIGHTING_VARIATIONS.length],
      MOOD_VARIATIONS[
        Math.floor(iteration / (SHOT_VARIATIONS.length * LIGHTING_VARIATIONS.length)) % MOOD_VARIATIONS.length
      ],
      SCENE_VARIATIONS[
        Math.floor(
          iteration / (SHOT_VARIATIONS.length * LIGHTING_VARIATIONS.length * MOOD_VARIATIONS.length),
        ) % SCENE_VARIATIONS.length
      ],
      STYLE_VARIATIONS[
        Math.floor(
          iteration /
            (SHOT_VARIATIONS.length * LIGHTING_VARIATIONS.length * MOOD_VARIATIONS.length *
              SCENE_VARIATIONS.length),
        ) % STYLE_VARIATIONS.length
      ],
    ]);

    promptSet.add(variantParts.join(', '));
    iteration += 1;
  }

  return Array.from(promptSet).slice(0, safeCount);
};