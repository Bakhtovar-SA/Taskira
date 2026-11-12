import { api } from "./index";
import type { ApplicationsDto, ApplicationsPatchBody } from "../../server/src/applicationContract";

export const applicationsApi = {
  get: (signal?: AbortSignal) => api<ApplicationsDto>("/api/applications", { signal }),
  patch: async (body: ApplicationsPatchBody) => {
    const result = await api<ApplicationsDto>("/api/applications", { method: "PATCH", body });
    window.dispatchEvent(new Event("taskira:applications"));
    return result;
  },
};
