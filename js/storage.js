// Shared localStorage helpers. Owned by nobody — anything that needs
// persistent state lives here to avoid import cycles between the
// modules that read and write it.

const PINNED_KEY = "zblocks.pinned";

export function loadPinnedZids() {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(z => /^Z\d+$/.test(z)) : [];
  } catch {
    return [];
  }
}

export function savePinnedZids(zids) {
  localStorage.setItem(PINNED_KEY, JSON.stringify([...new Set(zids)]));
}
