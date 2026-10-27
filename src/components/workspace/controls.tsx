"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import type { GenerationTask } from "@/lib/domain";

export interface Confirmation {
  title: string;
  description: string;
  label: string;
  destructive?: boolean;
  action: () => void;
}
export function ConfirmDialog({
  value,
  onClose,
}: {
  value: Confirmation | null;
  onClose: () => void;
}) {
  return (
    <AlertDialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{value?.title}</AlertDialogTitle>
          <AlertDialogDescription>{value?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={value?.destructive ? "destructive" : "default"}
            onClick={() => value?.action()}
          >
            {value?.label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
export function Selection({
  id,
  label,
  value,
  items,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  items: { value: string; label: string; disabled?: boolean }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
export function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  disabled,
  description,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
  description?: ReactNode;
}) {
  const invalid = !Number.isInteger(value) || value < min || value > max;
  return (
    <Field data-invalid={invalid} data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}
const STATUS = {
  idle: "待开始",
  running: "生成中",
  pausing: "正在暂停",
  paused: "已暂停",
  stopped: "已停止",
  completed: "生成结束",
  error: "请求失败",
};
export function StatusBadge({ status }: { status: GenerationTask["status"] }) {
  return (
    <Badge
      variant={status === "error" ? "destructive" : "outline"}
      className={cn(
        status === "completed" && "text-success",
        ["running", "pausing"].includes(status) && "text-primary",
      )}
    >
      <span
        className={cn("size-1.5 rounded-full bg-current", status === "running" && "animate-pulse")}
      />
      {STATUS[status]}
    </Badge>
  );
}
