import type { Id } from '../../convex/_generated/dataModel'

// Загрузка файла в хранилище Convex: сначала одноразовый URL от сервера, потом
// сам файл прямо в хранилище. Так же работают вложения задач — файл не
// проходит через мутацию, поэтому размер не упирается в лимит аргументов.
export async function uploadToStorage(
  generateUploadUrl: () => Promise<string>,
  file: File,
): Promise<Id<'_storage'>> {
  const url = await generateUploadUrl()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) throw new Error('Не удалось загрузить файл')
  const { storageId } = (await res.json()) as { storageId: Id<'_storage'> }
  return storageId
}
