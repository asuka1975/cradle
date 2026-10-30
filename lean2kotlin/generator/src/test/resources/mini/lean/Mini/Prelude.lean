/-
  層に依存しない汎用の List 補題。ドメインの内容はここに置かない。
-/
namespace Mini.Prelude

/-- 1 件だけ差し替える点更新。`f` が id を変えないなら同一性列は保たれる。 -/
def updateWhere {α : Type} (p : α → Bool) (f : α → α) (xs : List α) : List α :=
  xs.map (fun x => if p x then f x else x)

theorem updateWhere_map_of_key {α β : Type} (p : α → Bool) (f : α → α) (key : α → β)
    (hkey : ∀ x, key (f x) = key x) (xs : List α) :
    (updateWhere p f xs).map key = xs.map key := by
  simp only [updateWhere, List.map_map]
  apply List.map_congr_left
  intro x _
  by_cases h : p x <;> simp [Function.comp, h, hkey]

theorem nodup_append_one {α : Type} (xs : List α) (a : α) :
    (xs ++ [a]).Nodup ↔ (xs.Nodup ∧ a ∉ xs) := by
  rw [List.nodup_append]
  constructor
  · rintro ⟨h1, _, h3⟩
    exact ⟨h1, fun hmem => h3 a hmem a (by simp) rfl⟩
  · rintro ⟨h1, h2⟩
    refine ⟨h1, by simp, ?_⟩
    intro x hx b hb
    simp only [List.mem_singleton] at hb
    subst hb
    intro hxa
    exact h2 (hxa ▸ hx)

end Mini.Prelude
