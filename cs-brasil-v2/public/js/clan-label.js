export const clanTag = value => typeof value === 'string' && /^[A-Z0-9]{2,5}$/.test(value) ? value : '';
export const clanName = (name, tag) => `${clanTag(tag) ? `[${clanTag(tag)}] ` : ''}${name || ''}`;
export const escapeClanName = (name, tag) => clanName(name, tag)
  .replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
