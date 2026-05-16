function buildTaskTree(list) {
  const byParent = {};
  const idSet = new Set(list.map((task) => task.id));

  list.forEach((task) => {
    const parentId = task.parent;
    if (parentId === null || parentId === undefined || !idSet.has(parentId)) return;
    if (task.hierarchyOverLimit || task.hierarchyCycle) return;
    if (!byParent[parentId]) byParent[parentId] = [];
    byParent[parentId].push(task);
  });

  const roots = list.filter((task) => {
    const parentId = task.parent;
    return parentId === null ||
      parentId === undefined ||
      !idSet.has(parentId) ||
      task.hierarchyOverLimit ||
      task.hierarchyCycle;
  });

  return { roots, byParent };
}

export { buildTaskTree };
