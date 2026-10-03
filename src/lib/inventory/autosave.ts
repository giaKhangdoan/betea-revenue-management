export function queueInventorySave<T>(previous: Promise<unknown>, save: () => Promise<T>): Promise<T> {
  return previous.catch(() => undefined).then(save);
}
