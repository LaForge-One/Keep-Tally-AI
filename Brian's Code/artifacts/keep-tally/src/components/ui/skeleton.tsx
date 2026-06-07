import { cn } from "@/lib/utils";

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton-shimmer", className)} {...props} />;
}

function PageSkeleton({
  rows = 6,
  cols = 1,
}: {
  rows?: number;
  cols?: number;
}) {
  const columnCount = Math.min(cols, 4);

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-center justify-between border-b border-border pb-5">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: columnCount }).map((_, index) => (
          <Skeleton key={index} className="h-20 rounded-lg" />
        ))}
      </div>

      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

export { Skeleton, PageSkeleton };
