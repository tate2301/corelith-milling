"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@corelithzw/react";

import { MillSettingsShell } from "@/components/milling/settings-shell";
import { useMillAccess } from "@/components/milling/use-mill-access";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { fetchJson, getApiErrorMessage } from "@/lib/api-client";
import type { MillGroup, MillGroupCode } from "@/lib/milling/access/groups";
import type { MillMemberRow } from "@/lib/milling/access/membership";

type GroupsResponse = { groups: MillGroup[]; members: MillMemberRow[] };

const ROLES_WITH_EVERYTHING = new Set(["SUPERADMIN", "MANAGER"]);

/**
 * Who is in which of the mill's eight groups. One person may hold several;
 * each tick saves on its own. Owners and managers may do everything at the
 * mill without a group.
 */
export default function MillGroupsPage() {
  const access = useMillAccess();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const allowed = access.can("settings.manage");

  const query = useQuery({
    queryKey: ["milling", "groups"],
    queryFn: () => fetchJson<GroupsResponse>("/api/milling/groups"),
    enabled: allowed,
  });

  const save = useMutation({
    mutationFn: (args: { userId: string; groups: MillGroupCode[] }) =>
      fetchJson<{ userId: string; groups: MillGroupCode[] }>("/api/milling/groups", {
        method: "PUT",
        body: JSON.stringify(args),
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData<GroupsResponse>(["milling", "groups"], (current) =>
        current
          ? {
              ...current,
              members: current.members.map((member) =>
                member.userId === saved.userId ? { ...member, groups: saved.groups } : member,
              ),
            }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: ["milling", "me"] });
    },
    onError: (error) => toast({ title: "Not saved", description: getApiErrorMessage(error), variant: "destructive" }),
  });

  if (access.isLoading) return <MillSettingsShell><Skeleton className="h-64 w-full" /></MillSettingsShell>;
  if (!allowed) {
    return (
      <MillSettingsShell>
        <EmptyState title="Only an administrator can change groups" body="Ask someone in the System administrator group, or the workspace owner." />
      </MillSettingsShell>
    );
  }

  const groups = query.data?.groups ?? [];
  const members = query.data?.members ?? [];

  function toggle(member: MillMemberRow, code: MillGroupCode, on: boolean) {
    const next = on ? [...member.groups, code] : member.groups.filter((group) => group !== code);
    save.mutate({ userId: member.userId, groups: next });
  }

  return (
    <MillSettingsShell>
      {query.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{getApiErrorMessage(query.error)}</AlertDescription>
        </Alert>
      ) : query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : members.length === 0 ? (
        <EmptyState title="No one to place yet" body="Add people under People first; they appear here to be given groups." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                {groups.map((group) => (
                  <TableHead key={group.code} title={group.description} className="text-center">
                    {group.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>
                    <div className="font-medium">{member.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {ROLES_WITH_EVERYTHING.has(member.role) ? "Owner or manager: may do everything" : member.email}
                      {member.isActive ? "" : " · access removed"}
                    </div>
                  </TableCell>
                  {groups.map((group) => (
                    <TableCell key={group.code} className="text-center">
                      <Checkbox
                        aria-label={`${member.name} in ${group.name}`}
                        checked={member.groups.includes(group.code)}
                        disabled={save.isPending}
                        onCheckedChange={(on) => toggle(member, group.code, on === true)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {groups.length > 0 ? (
        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group.code}>
              <dt className="font-medium">{group.name}</dt>
              <dd className="text-muted-foreground">{group.description}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </MillSettingsShell>
  );
}
