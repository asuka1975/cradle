/-
  層に依存しない汎用の List 補題。ドメインの内容はここに置かない。
-/
namespace Lobby.Prelude

/-- 1 件だけ差し替える点更新。`f` が id を変えないなら同一性列は保たれる。 -/
def updateWhere {α : Type} (p : α → Bool) (f : α → α) (xs : List α) : List α :=
  xs.map (fun x => if p x then f x else x)

@[simp] theorem updateWhere_nil {α : Type} (p : α → Bool) (f : α → α) :
    updateWhere p f ([] : List α) = [] := rfl

@[simp] theorem updateWhere_cons {α : Type} (p : α → Bool) (f : α → α) (x : α) (xs : List α) :
    updateWhere p f (x :: xs) = (if p x then f x else x) :: updateWhere p f xs := rfl

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

/-- 述語を満たす要素が無い列に 1 件足しても、満たす要素は高々 1 件。 -/
theorem filter_length_append_one_le {α : Type} (p : α → Bool) (xs : List α) (a : α)
    (h : (xs.filter p).length = 0) : ((xs ++ [a]).filter p).length ≤ 1 := by
  rw [List.filter_append, List.length_append, h]
  simp only [List.filter_cons, List.filter_nil, Nat.zero_add]
  split <;> simp

/-- 述語を満たす側へ変えない点更新は、満たす要素の数を増やさない。 -/
theorem filter_length_updateWhere_le {α : Type} (p q : α → Bool) (f : α → α) (xs : List α)
    (hf : ∀ x, p (f x) = true → p x = true) :
    ((updateWhere q f xs).filter p).length ≤ (xs.filter p).length := by
  induction xs with
  | nil => exact Nat.le_refl _
  | cons x xs ih =>
    have hg : p (if q x then f x else x) = true → p x = true := by
      intro h
      split at h
      · exact hf x h
      · exact h
    simp only [updateWhere_cons, List.filter_cons]
    by_cases h1 : p (if q x then f x else x) = true
    · rw [if_pos h1, if_pos (hg h1)]
      simp only [List.length_cons]
      omega
    · rw [if_neg h1]
      by_cases hx : p x = true
      · rw [if_pos hx]
        simp only [List.length_cons]
        omega
      · rw [if_neg hx]
        exact ih

/-- 鍵で引く探索は、鍵を変えない点更新を通り抜ける（見つかった要素に f が掛かる）。 -/
theorem find?_updateWhere_of_key {α β : Type} [BEq β] (key : α → β) (k : β) (f : α → α)
    (hf : ∀ x, key (f x) = key x) (xs : List α) :
    (updateWhere (fun x => key x == k) f xs).find? (fun x => key x == k) =
      (xs.find? (fun x => key x == k)).map f := by
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    simp only [updateWhere_cons, List.find?_cons]
    by_cases h : (key x == k) = true
    · rw [if_pos h]
      have h' : (key (f x) == k) = true := by rw [hf]; exact h
      simp [h, h']
    · rw [if_neg h]
      simp only [Bool.not_eq_true] at h
      simp [h, ih]

theorem all_updateWhere {α : Type} (p : α → Bool) (f : α → α) (q : α → Bool) (xs : List α)
    (hq : xs.all q = true) (hf : ∀ x, q x = true → q (f x) = true) :
    (updateWhere p f xs).all q = true := by
  induction xs with
  | nil => rfl
  | cons x xs ih =>
    rw [updateWhere_cons, List.all_cons]
    rw [List.all_cons, Bool.and_eq_true] at hq
    refine Bool.and_eq_true _ _ |>.mpr ⟨?_, ih hq.2⟩
    by_cases h : p x
    · simpa [h] using hf x hq.1
    · simpa [h] using hq.1

/-- 成功した写像の分解（境界のルーティングから UseCase の結果を取り出す）。 -/
theorem except_map_eq_ok {ε α β : Type} {f : α → β} {x : Except ε α} {y : β}
    (h : x.map f = .ok y) : ∃ a, x = .ok a ∧ y = f a := by
  cases x with
  | error e => simp [Except.map] at h
  | ok a => exact ⟨a, rfl, by simpa [Except.map] using h.symm⟩

end Lobby.Prelude
