/**
 * Единый клиентский классификатор: сервер (Zhipu) → CLIP в браузере → null (ручной выбор).
 * Имя из CLIP на английском, категория — русская (маппинг лейблов).
 */
import { api } from '../api';
import { classifyWithClip } from './clipCore';

const MIN_CONFIDENCE = 0.32;

const CLIP_LABELS = {
  'Одежда': [
    'coat', 'jacket', 'shirt', 't-shirt', 'sweater', 'hoodie', 'dress',
    'skirt', 'pants', 'jeans', 'scarf',
  ],
  'Обувь': ['sneakers', 'pair of shoes', 'boots', 'sandals', 'high heels', 'slippers'],
  'Детям': ['teddy bear', 'doll', 'toy car', 'stroller', 'children bicycle', 'lego blocks'],
  'Мебель': ['chair', 'wooden table', 'sofa', 'bed', 'wardrobe', 'bookshelf', 'desk', 'armchair'],
  'Техника': [
    'washing machine', 'refrigerator', 'microwave oven', 'vacuum cleaner',
    'electric stove', 'dishwasher', 'iron',
  ],
  'Электроника': [
    'smartphone', 'laptop', 'computer monitor', 'keyboard', 'tablet',
    'headphones', 'digital camera', 'computer mouse',
  ],
  'Посуда': ['ceramic plate', 'coffee mug', 'glass cup', 'cooking pot', 'frying pan', 'cutlery', 'bowl', 'teapot'],
  'Книги': ['book', 'stack of books', 'notebook', 'magazine', 'textbook'],
  'Спорт': ['bicycle', 'dumbbell', 'football', 'basketball', 'tennis racket', 'yoga mat', 'roller skates'],
  'Инструменты': ['hammer', 'screwdriver', 'drill', 'wrench', 'saw', 'toolbox'],
  'Красота': ['cosmetics', 'lipstick', 'perfume bottle', 'shampoo bottle', 'hair dryer'],
  'Растения': ['potted plant', 'flower pot', 'plant in pot', 'seedlings'],
  'Животным': ['cat litter box', 'pet carrier', 'fish aquarium', 'dog bowl', 'pet cage'],
};

const LABEL_TO_CATEGORY = Object.fromEntries(
  Object.entries(CLIP_LABELS).flatMap(([cat, labels]) => labels.map((l) => [l, cat])),
);

function allLabels() {
  return Object.values(CLIP_LABELS).flat();
}

async function classifyLocally(imageBlob) {
  const result = await classifyWithClip(imageBlob, allLabels());
  if (!result) return null;
  const category = LABEL_TO_CATEGORY[result.name];
  if (!category || result.confidence < MIN_CONFIDENCE) return null;
  return { name: result.name, category, confidence: result.confidence, source: 'clip' };
}

/**
 * Полный конвейер: сервер → CLIP → null.
 * Возвращает { name, category, confidence } или null (тогда пользователь выбирает вручную).
 */
export async function classifyImage(imageBlob) {
  if (!imageBlob) return null;

  try {
    const server = await api.classifyImage(imageBlob);
    if (server && !server.fallback && server.category) {
      return {
        name: server.name,
        category: server.category,
        confidence: server.confidence,
        source: 'vision',
      };
    }
  } catch (err) {
    console.warn('[classify] server failed, falling back to CLIP:', err);
  }

  return classifyLocally(imageBlob);
}