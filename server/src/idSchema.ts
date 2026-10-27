import { z } from "zod";

/** Keep accepting UUID-shaped legacy ids that Zod 3 accepted, including non-RFC variants. */
export const uuid = z.guid({ error: "Ожидается UUID" });
