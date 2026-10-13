import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import { getGateAuthKind } from "../request-context.js";
import {
  listPromptTemplates,
  readPromptTemplate,
  resetPromptTemplate,
  savePromptTemplate,
} from "../services/system/prompt-templates.js";
import type { AppDeps } from "../types.js";

export function registerPromptTemplateRoutes(app: Hono, deps: AppDeps): void {
  const { del, get, put } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.system;

  get(routes.promptTemplates, (context) =>
    context.json(listPromptTemplates(deps)),
  );

  get(routes.promptTemplate, (context) =>
    context.json({
      template: readPromptTemplate(deps, context.req.param("id")),
    }),
  );

  put(routes.savePromptTemplate, (context, payload) => {
    if (getGateAuthKind(context) === "machine") {
      throw new ApiError(
        403,
        "forbidden",
        "Machine credentials cannot edit prompt templates",
      );
    }
    return context.json(
      savePromptTemplate(deps, context.req.param("id"), payload.body),
    );
  });

  del(routes.resetPromptTemplate, (context) => {
    if (getGateAuthKind(context) === "machine") {
      throw new ApiError(
        403,
        "forbidden",
        "Machine credentials cannot edit prompt templates",
      );
    }
    return context.json({
      template: resetPromptTemplate(deps, context.req.param("id")),
    });
  });
}
