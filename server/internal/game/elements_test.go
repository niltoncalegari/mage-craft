package game

import "testing"

func TestAllElements_Has7UniqueIDs(t *testing.T) {
	ids := AllElements()
	if len(ids) != 7 {
		t.Fatalf("expected 7 elements, got %d", len(ids))
	}

	seen := make(map[ElementID]bool, len(ids))
	for _, id := range ids {
		if seen[id] {
			t.Fatalf("duplicate element id in catalog: %s", id)
		}
		seen[id] = true
	}

	for _, want := range []ElementID{
		ElementFire, ElementIce, ElementLightning, ElementPoison,
		ElementStone, ElementArcane, ElementWind,
	} {
		if !seen[want] {
			t.Errorf("catalog missing expected element %s", want)
		}
	}
}

func TestElementDef_EveryCatalogEntryResolves(t *testing.T) {
	for _, id := range AllElements() {
		if _, ok := ElementDefFor(id); !ok {
			t.Errorf("ElementDefFor(%s) missing a definition", id)
		}
	}
}

func TestElementDef_DirectionalDesign(t *testing.T) {
	fire, _ := ElementDefFor(ElementFire)
	ice, _ := ElementDefFor(ElementIce)
	lightning, _ := ElementDefFor(ElementLightning)
	poison, _ := ElementDefFor(ElementPoison)
	stone, _ := ElementDefFor(ElementStone)
	arcane, _ := ElementDefFor(ElementArcane)
	wind, _ := ElementDefFor(ElementWind)

	if lightning.ProjectileSpeed <= fire.ProjectileSpeed {
		t.Errorf("lightning should fly faster than fire (GDD §8.4)")
	}
	if stone.ProjectileSpeed >= fire.ProjectileSpeed {
		t.Errorf("stone should fly slower than fire (GDD §8.6)")
	}
	if stone.Damage <= fire.Damage {
		t.Errorf("stone should hit harder than fire (GDD §8.6)")
	}
	if !stone.InterruptsCharge {
		t.Errorf("stone must interrupt the target's charge (GDD §8.6)")
	}
	if ice.SlowFactor <= 0 || ice.SlowDuration <= 0 {
		t.Errorf("ice must apply a slow (GDD §8.3)")
	}
	if !poison.SpawnsPuddle || poison.PuddleRadius <= 0 || poison.PuddleDuration <= 0 {
		t.Errorf("poison must spawn a ground puddle (GDD §8.5)")
	}
	if arcane.SplashRadius <= 0 {
		t.Errorf("arcane must have an on-impact AoE splash (GDD §8.7)")
	}
	if wind.KnockbackBonus <= 0 {
		t.Errorf("wind must push harder than baseline (GDD §8.7)")
	}
}
