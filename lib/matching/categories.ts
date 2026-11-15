// Person 3: category vocabulary shared by the AI prompts and the pre-filter.
// The AI is asked to pick one of CATEGORIES so finders and owners land in the same group.

export const CATEGORY_GROUPS: Record<string, string[]> = {
  bottle: ['water bottle', 'bottle', 'flask', 'tumbler', 'thermos', 'mug', 'cup', 'hydro flask', 'stanley'],
  headphones: ['headphones', 'earbuds', 'airpods', 'earphones', 'headset', 'beats'],
  bag: ['backpack', 'bag', 'tote', 'purse', 'handbag', 'duffel', 'pouch', 'lunchbox', 'pencil case'],
  clothing: ['jacket', 'hoodie', 'sweater', 'sweatshirt', 'coat', 'shirt', 'hat', 'cap', 'beanie', 'scarf', 'gloves', 'clothing'],
  phone: ['phone', 'iphone', 'smartphone', 'android', 'cell'],
  computer: ['laptop', 'tablet', 'ipad', 'macbook', 'chromebook', 'computer', 'kindle', 'e-reader'],
  wallet: ['wallet', 'card', 'id', 'usc id', 'credit card', 'debit card', 'card holder', 'passport', 'license'],
  keys: ['keys', 'key', 'keychain', 'key fob', 'lanyard'],
  charger: ['charger', 'cable', 'power bank', 'adapter', 'cord', 'battery'],
  umbrella: ['umbrella'],
  glasses: ['glasses', 'sunglasses', 'eyeglasses', 'glasses case'],
  jewelry: ['watch', 'smartwatch', 'apple watch', 'ring', 'necklace', 'bracelet', 'earring', 'jewelry'],
  book: ['book', 'notebook', 'textbook', 'binder', 'folder', 'planner'],
  stationery: ['scissors', 'stapler', 'ruler', 'pen', 'pencil'],
  electronics: ['remote', 'remote control', 'speaker', 'controller', 'game controller', 'mouse', 'camera', 'calculator', 'usb drive', 'flash drive', 'stylus', 'apple pencil'],
};

/** Suggested canonical categories, given to the AI in prompts. */
export const CATEGORIES = [
  'water bottle', 'headphones', 'earbuds', 'backpack', 'bag', 'tote', 'jacket', 'hoodie', 'sweater', 'hat',
  'phone', 'laptop', 'tablet', 'wallet', 'id card', 'credit/debit card', 'passport', 'keys', 'charger',
  'power bank', 'umbrella', 'glasses', 'watch', 'jewelry', 'notebook', 'textbook', 'calculator', 'remote control',
  'speaker', 'game controller', 'camera', 'stylus', 'scissors',
];

/** Map a free-text category to a group key; unknown → 'other'. Longest keyword wins (so "card holder" beats "card"). */
export function categoryGroup(category: string | null | undefined): string {
  const c = (category ?? '').toLowerCase().trim();
  if (!c) return 'other';
  let best: { group: string; len: number } | null = null;
  for (const [group, words] of Object.entries(CATEGORY_GROUPS)) {
    for (const w of words) {
      const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`);
      if (re.test(c) && (!best || w.length > best.len)) best = { group, len: w.length };
    }
  }
  return best?.group ?? 'other';
}

export function sameCategoryGroup(a: string | null | undefined, b: string | null | undefined): boolean {
  const ga = categoryGroup(a);
  const gb = categoryGroup(b);
  if (ga === 'other' || gb === 'other') {
    // Unknown categories: only match on the same text, so "calculator" still finds "calculator".
    // Singular and plural count as the same ("shoelace" finds "shoelaces", "box" finds "boxes").
    return ga === gb && sameWord((a ?? '').toLowerCase().trim(), (b ?? '').toLowerCase().trim());
  }
  return ga === gb;
}

function sameWord(a: string, b: string): boolean {
  const pluralOf = (one: string, many: string) => many === `${one}s` || many === `${one}es`;
  return a === b || pluralOf(a, b) || pluralOf(b, a);
}
