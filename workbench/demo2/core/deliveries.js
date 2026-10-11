/* Material identity and immutable delivery snapshots, shared by browser and server. */
(function (root) {
  root.WB ||= {};
  const copy = (v) => JSON.parse(JSON.stringify(v));
  function normalise(doc, imported = false) {
    for (const [key, material] of Object.entries(doc.materials || {})) {
      if (!material || typeof material !== 'object') continue;
      material.materialId ||= `MAT-${key}`;
      material.deliveries = Array.isArray(material.deliveries) ? material.deliveries : [];
      if (imported) material.deliveries = material.deliveries.map((v) => ({ ...v, origin: 'imported' }));
      if (String(material.source).startsWith('ai')) material.aiDraft = true;
    }
    return doc;
  }
  function resolve(doc, ref) {
    if (!validRefs([ref])) return null;
    for (const [key, material] of Object.entries(doc.materials || {})) {
      if (material?.materialId !== ref.materialId) continue;
      const version = material.deliveries?.find((v) => v?.id === ref.versionId);
      if (version) return { key, material, version };
    }
    return null;
  }
  const validRefs = (refs) => Array.isArray(refs) && refs.length > 0 && refs.length <= 100 && refs.every((r) => r && typeof r.materialId === 'string' && r.materialId.trim() && typeof r.versionId === 'string' && r.versionId.trim()) && new Set(refs.map((r) => JSON.stringify([r.materialId, r.versionId]))).size === refs.length;
  function publish(doc, key, context, note = '') {
    normalise(doc);
    const material = doc.materials?.[key];
    if (!material || !Array.isArray(material.sections) || !material.sections.some((section) => typeof section?.body === 'string' && section.body.trim())) throw new Error('请先准备实际材料正文，再确认交付版本；仅有标题或空栏目不能交付。');
    const { deliveries, previous, ...content } = material;
    const snapshot = { material: copy(content), reference: copy(doc.references?.[key] || null), fillDrafts: copy(doc.fillDrafts?.[key] || {}), ...(key === 'poster' ? { poster: copy(doc.poster || {}) } : {}), ...(key === 'materialList' ? { resources: copy(doc.resources || []) } : {}) };
    const version = { id: context.id, number: Math.max(0, ...deliveries.map((v) => Number(v.number) || 0)) + 1, at: context.at, actor: copy(context.actor), origin: context.origin, note: String(note).trim().slice(0, 4000), snapshot };
    material.deliveries.push(version);
    return version;
  }
  root.WB.deliveries = { normalise, resolve, validRefs, publish };
}(typeof window === 'undefined' ? globalThis : window));
