/**
 * CLIP-классификатор в браузере — резервный уровень распознавания,
 * когда серверный Zhipu недоступен. Модель скачивается один раз с HuggingFace CDN.
 */
let classifierPromise = null;

function loadClassifier() {
  if (!classifierPromise) {
    classifierPromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      const pipe = await pipeline(
        'zero-shot-image-classification',
        'Xenova/clip-vit-base-patch32',
      );
      return pipe;
    })();
  }
  return classifierPromise;
}

/**
 * Возвращает { name, confidence } лучшего лейбла или null при ошибке/низкой уверенности.
 * labels — плоский массив англ. лейблов для zero-shot.
 */
export async function classifyWithClip(imageBlob, labels) {
  if (!imageBlob || !Array.isArray(labels) || !labels.length) return null;
  try {
    const classifier = await loadClassifier();
    const results = await classifier(imageBlob, labels);
    if (!Array.isArray(results) || !results.length) return null;
    const [top] = results;
    if (!top || typeof top.score !== 'number') return null;
    return { name: String(top.label || ''), confidence: top.score };
  } catch (err) {
    console.warn('[clip] classify failed:', err);
    return null;
  }
}

export function clipReady() {
  return Boolean(classifierPromise);
}

if (typeof window !== 'undefined') {
  window.__clipPrefetch = () => {
    loadClassifier().catch(() => {});
  };
}