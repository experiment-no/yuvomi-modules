/** Household members from Yuvomi. Names are for labels. Access uses the ids the service stored. */

export async function loadMembers(signal) {
  try {
    const { api } = await import('/api.js');
    const res = await api.get('/family/members', { signal });
    const rows = Array.isArray(res?.data) ? res.data : [];
    return rows
      .map((row) => ({ id: String(row?.id ?? ''), name: String(row?.display_name || row?.id || '').trim() }))
      .filter((row) => row.id && row.name);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    return [];
  }
}

export function memberName(members, id) {
  const found = (members || []).find((member) => member.id === String(id ?? ''));
  return found?.name || '';
}
