import { cn } from "@/client/lib/utils"
import { PrimitiveDivProps, PrimitiveSpanProps } from "@radix-ui/react-select"
import * as React from "react"

const TagsInput = React.forwardRef<HTMLDivElement, PrimitiveDivProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        className={cn('flex flex-wrap items-center gap-2 border rounded-md p-1',
          className)}
        ref={ref}
        {...props}
        >
          {children}
      </div>
    )
  },
)
TagsInput.displayName = "TagsInput"

const TagsInputItem = React.forwardRef<HTMLDivElement, PrimitiveDivProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        className={cn('flex items-center gap-1 rounded-md bg-primary-foreground text-primary-background px-2 py-1', className)}
        ref={ref}
        {...props}
        >
          {children}
      </div>
    )
  }
)
TagsInputItem.displayName = "TagsInputItem"

const TagsInputItemText = React.forwardRef<HTMLSpanElement, PrimitiveSpanProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <span
        className={cn('', className)}
        ref={ref}
        {...props}
        >
        {children}
      </span>
    )
  }
)
TagsInputItemText.displayName = "TagsInputItemText"

const TagsInputItemDelete = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, ...props }, ref) => {
    return (
      <button
        className={cn('rounded-md bg-primary-foreground text-primary-background px-1', 
          className)}
        ref={ref}
        {...props}
      />
    )
  }
)

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const TagsInputInput = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn('text-primary-background rounded-md px-2 py-1',
          className)}
        ref={ref}
        {...props}
      />
    )
  },
)
TagsInputInput.displayName = 'TagsInputInput'

export {
  TagsInput,
  TagsInputItem,
  TagsInputItemText,
  TagsInputItemDelete,
  TagsInputInput,
}
