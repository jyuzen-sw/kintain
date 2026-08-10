"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAdminEmployees } from "../../lib/client/admin-api";
import type { EmployeeDirectoryItem } from "../../lib/contracts/types";
import { ActionButton, EmptyState, InlineNotice, LoadingPanel } from "../shared/ui";
import { AdminFilterBar, AdminPageHeader, ResultSummary } from "./admin-shared";

export function EmployeePickerView() {
  const [employees, setEmployees] = useState<EmployeeDirectoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEmployees(await getAdminEmployees());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "従業員一覧を読み込めませんでした。",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredEmployees = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return employees;
    return employees.filter((employee) =>
      [employee.displayName, employee.employeeCode, employee.email]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedQuery)),
    );
  }, [employees, query]);

  return (
    <div className="admin-page">
      <AdminPageHeader
        description="従業員を選択して、月ごとの実績確認と修正へ進みます。"
        eyebrow="個人実績"
        title="従業員を選ぶ"
      >
        <ActionButton icon="refresh" loading={loading} onClick={() => void load()} variant="secondary">更新する</ActionButton>
      </AdminPageHeader>

      <AdminFilterBar>
        <label className="admin-field admin-field--search">
          <span>名前・社員コード・メール</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="従業員を検索"
            type="search"
            value={query}
          />
        </label>
      </AdminFilterBar>

      {error ? (
        <InlineNotice actions={<ActionButton onClick={() => void load()} variant="secondary">再試行する</ActionButton>} role="alert" title="従業員一覧を表示できません" tone="danger">
          {error}
        </InlineNotice>
      ) : null}

      {loading && employees.length === 0 ? (
        <LoadingPanel label="従業員を読み込んでいます" />
      ) : (
        <section aria-busy={loading}>
          <ResultSummary>{filteredEmployees.length}名</ResultSummary>
          {filteredEmployees.length === 0 ? (
            <EmptyState message="検索条件を変えてもう一度お試しください。" title="該当する従業員がいません" />
          ) : (
            <div className="admin-employee-grid">
              {filteredEmployees.map((employee) => (
                <Link className="admin-employee-card" href={`/admin/users/${encodeURIComponent(employee.id)}`} key={employee.id}>
                  <span className="admin-employee-card__avatar" aria-hidden="true">{employee.displayName.slice(0, 1)}</span>
                  <span className="admin-employee-card__identity">
                    <strong>{employee.displayName}</strong>
                    <small>{employee.employeeCode ?? "社員コードなし"}</small>
                    <small>{employee.email}</small>
                  </span>
                  <span className="admin-employee-card__action">実績を見る</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
