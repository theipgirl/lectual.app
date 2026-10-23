import type { FeedbackType } from "./constants";

/** The one shape the browser posts: type, description and the serialised trail. Nothing else is sent. */
export function buildFeedbackForm(input: { type: FeedbackType; description: string; trailJson: string }): FormData {
  const form = new FormData();
  form.set("type", input.type);
  form.set("description", input.description);
  form.set("trail", input.trailJson);
  return form;
}
