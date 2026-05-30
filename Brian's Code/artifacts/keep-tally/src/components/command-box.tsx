import { useState, useRef, useEffect } from "react";
import { Terminal, Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useRunCommand, getListItemsQueryKey, getListHistoryQueryKey, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";

export function CommandBox() {
  const [command, setCommand] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const runCommand = useRunCommand({
    mutation: {
      onSuccess: (data) => {
        if (data.success) {
          toast({
            title: "Command Executed",
            description: data.message,
            variant: "default",
          });
          setCommand("");
          // Invalidate queries to refresh data
          queryClient.invalidateQueries({ queryKey: getListItemsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        } else {
          toast({
            title: "Command Failed",
            description: data.message,
            variant: "destructive",
          });
        }
      },
      onError: (error) => {
        toast({
          title: "Error",
          description: error.data?.error || error.message || "An unknown error occurred.",
          variant: "destructive",
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || runCommand.isPending) return;
    runCommand.mutate({ data: { text: command } });
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col">
      <div className="bg-muted px-4 py-2 border-b border-border flex items-center gap-2">
        <Terminal className="w-4 h-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Command</span>
      </div>
      <form onSubmit={handleSubmit} className="p-2 flex gap-2 items-center bg-card">
        <Input
          ref={inputRef}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="e.g. Set Coke Zero in Mesa to 24..."
          className="border-0 shadow-none focus-visible:ring-0 text-base md:text-lg h-12 bg-transparent"
          disabled={runCommand.isPending}
        />
        <Button 
          type="submit" 
          size="icon" 
          disabled={!command.trim() || runCommand.isPending}
          className="h-10 w-10 shrink-0 rounded-lg"
        >
          {runCommand.isPending ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </Button>
      </form>
      {runCommand.data && (
        <div className={`px-4 py-3 border-t text-sm flex items-center gap-2 ${runCommand.data.success ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20" : "bg-destructive/10 text-destructive border-destructive/20"}`}>
          {runCommand.data.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span>{runCommand.data.message}</span>
        </div>
      )}
    </div>
  );
}
