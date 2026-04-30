# nested-mixed test vault

Fixture exercising the user's nested JD-in-SEACOW scenario.

Structure:

```
01 - Projects                          (JD top-level)
  └── Cybersader                       (entity-like sub-anchor)
        ├── 01 - Active                (JD nested)
        ├── 02 - Archive               (JD nested)
        └── 03 - Reference             (JD nested)
02 - Areas                             (JD top-level)
  └── Health
03 - Resources                         (JD top-level)
Templates                              (no match)
```

Detection should find:

- JD pack: 6 hits across 2 anchored instances (root + Cybersader)
- Detection tree should show both anchors visually

Used by `test/specs/scope-detect.e2e.ts`.
