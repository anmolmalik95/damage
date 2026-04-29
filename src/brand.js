const hostname = typeof window !== 'undefined' ? window.location.hostname : '';

export const IS_DAMAGE = hostname.startsWith('damage.');
export const BRAND_NAME = IS_DAMAGE ? 'Damage' : 'Unfuck';
export const BRAND_WORDMARK = IS_DAMAGE ? 'DAMAGE' : 'UNFUCK';
