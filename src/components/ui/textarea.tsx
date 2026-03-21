import type { TextareaHTMLAttributes } from "react";
import { textareaClass } from "@/lib/ui/form-classes";
import { cn } from "@/lib/utils/cn";

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(textareaClass, className)} {...props} />;
}
