import { apiClient } from './client'
import type { Project, ProjectDetail, CreateProjectRequest, UpdateProjectRequest, SaveSceneRequest } from '@/types/project'

export const projectApi = {
  async createProject(data: CreateProjectRequest): Promise<Project> {
    return apiClient.post<Project>('/project', data)
  },

  async getMyProjects(): Promise<Project[]> {
    return apiClient.get<Project[]>('/project/my')
  },

  async getPublicProjects(): Promise<Project[]> {
    return apiClient.get<Project[]>('/project/public')
  },

  async getProject(id: string): Promise<ProjectDetail> {
    return apiClient.get<ProjectDetail>(`/project/${id}`)
  },

  async loadScene(id: string): Promise<ProjectDetail> {
    return apiClient.get<ProjectDetail>(`/project/${id}/scene`)
  },

  async saveScene(id: string, data: SaveSceneRequest): Promise<void> {
    return apiClient.post<void>(`/project/${id}/save`, data)
  },

  async updateProject(id: string, data: UpdateProjectRequest): Promise<Project> {
    return apiClient.put<Project>(`/project/${id}`, data)
  },

  async deleteProject(id: string): Promise<void> {
    return apiClient.delete<void>(`/project/${id}`)
  },

  async countByUserId(userId: string): Promise<number> {
    return apiClient.get<number>(`/project/count?userId=${userId}`)
  },

  async uploadThumbnail(file: Blob, projectId?: string): Promise<string> {
    const formData = new FormData()
    formData.append('file', file, 'thumbnail.jpg')
    // 携带项目ID，后端以项目ID作为缩略图文件名：同一项目的新缩略图会覆盖旧文件，避免累积
    if (projectId) formData.append('projectId', projectId)
    return apiClient.upload<string>('/project/upload-thumbnail', formData)
  },

  // ---- 回收站 ----
  async getTrashedProjects(): Promise<Project[]> {
    return apiClient.get<Project[]>('/project/trash')
  },

  async restoreProject(id: string): Promise<void> {
    return apiClient.post<void>(`/project/${id}/restore`)
  },

  async purgeProject(id: string): Promise<void> {
    return apiClient.delete<void>(`/project/${id}/purge`)
  },
}
