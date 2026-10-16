import type { Project } from './types'

export function primaryImageFile(project: Project, imageId: string): string {
  const image = project.images.find(i => i.id === imageId)
  if (!image) throw new Error('Reference image no longer exists. Select it again before generating.')
  const session = project.editSessions.find(s => s.rootImageId === imageId)
  if (session?.primaryNodeId) {
    const node = session.nodes.find(n => n.id === session.primaryNodeId)
    if (!node?.file) throw new Error(`The primary version of ${image.title} is missing. Choose a primary image before generating.`)
    return node.file
  }
  return session?.originalFile ?? image.file
}

// Recover legacy queued paths without replacing independently kept Library copies.
export function imageAssetIdForFile(project: Project, file: string): string | undefined {
  const direct = project.images.find(i => i.file === file)
  if (direct) return direct.id
  const sessions = project.editSessions.filter(s => s.rootImageId && (s.originalFile === file || s.nodes.some(n => n.file === file)))
  return sessions.length === 1 ? sessions[0].rootImageId : undefined
}

export function resolveRenderImages(project: Project, req: { images: string[]; imageAssetIds?: (string | null)[]; endImage?: string; endImageAssetId?: string }): { images: string[]; endImage?: string } {
  const resolve = (file: string, id?: string | null): string => {
    const assetId = id ?? imageAssetIdForFile(project, file)
    return assetId ? primaryImageFile(project, assetId) : file
  }
  return { images: req.images.map((file, i) => resolve(file, req.imageAssetIds?.[i])), endImage: req.endImage ? resolve(req.endImage, req.endImageAssetId) : undefined }
}

export function imageEditSource(project: Project, rootImageId: string, parentNodeId: string | null): string | undefined {
  const session = project.editSessions.find(s => s.rootImageId === rootImageId)
  if (parentNodeId) {
    const node = session?.nodes.find(n => n.id === parentNodeId)
    if (!node?.file) throw new Error('The selected image edit no longer exists. Select its source again.')
    return node.file
  }
  // The explicit original row must match its preview, even with another primary.
  return rootImageId ? session?.originalFile ?? primaryImageFile(project, rootImageId) : undefined
}
