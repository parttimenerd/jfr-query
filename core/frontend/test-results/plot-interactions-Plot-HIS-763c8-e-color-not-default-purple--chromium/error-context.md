# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plot-interactions.spec.ts >> Plot: HISTOGRAM PALETTE clause >> H1. HISTOGRAM with PALETTE renders bar with palette color (not default purple)
- Location: e2e/plot-interactions.spec.ts:645:3

# Error details

```
Error: expect(received).not.toBe(expected) // Object.is equality

Expected: not "#8884d8"
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e5]:
        - heading "JFR Query Notebook" [level=1] [ref=e6]
        - generic "Running in-browser via DuckDB-WASM" [ref=e7]: WASM
        - generic "JFR recording" [ref=e8]: JFR
        - button "$session_start Mar 15, 10:00 AM" [ref=e10]:
          - generic [ref=e11]: $session_start
          - generic [ref=e12]: Mar 15, 10:00 AM
        - button "$session_end Mar 15, 10:19 AM" [ref=e13]:
          - generic [ref=e14]: $session_end
          - generic [ref=e15]: Mar 15, 10:19 AM
        - generic [ref=e17]:
          - button "Undo" [ref=e18]:
            - img [ref=e19]
          - button "Redo" [disabled] [ref=e21]:
            - img [ref=e22]
        - generic [ref=e24]:
          - button "Disable Auto-Run" [ref=e25]:
            - img [ref=e26]
          - button "Run All Queries" [ref=e28]:
            - img [ref=e29]
      - generic [ref=e31]:
        - button "Collapse All" [ref=e32]:
          - img [ref=e33]
        - button "Expand All" [ref=e35]:
          - img [ref=e36]
        - button "Clear All Results" [ref=e38]:
          - img [ref=e39]
        - button "Load Notebook" [ref=e42]:
          - img [ref=e43]
        - button "New from template" [ref=e45]:
          - img [ref=e46]
        - button "New GC Analysis Notebook" [ref=e48]:
          - img [ref=e49]
        - button "Save Notebook" [ref=e51]:
          - img [ref=e52]
        - button "Edit Raw Markdown" [ref=e54]:
          - img [ref=e55]
        - button "Disable AI Features" [ref=e57]:
          - img [ref=e58]
        - button "Presenter Mode" [ref=e61]:
          - img [ref=e62]
        - link "Documentation" [ref=e66] [cursor=pointer]:
          - /url: https://parttimenerd.github.io/jfr-query/docs/
          - img [ref=e67]
        - button "Settings" [ref=e69]:
          - img [ref=e70]
    - generic [ref=e73]:
      - generic [ref=e74]:
        - generic [ref=e76]:
          - generic [ref=e77]:
            - generic [ref=e78]:
              - heading "Schema Explorer" [level=2] [ref=e79]:
                - img [ref=e80]
                - text: Schema Explorer
              - button "Reset Layout" [ref=e82]:
                - img [ref=e83]
              - button "Refresh Schema" [ref=e85]:
                - img [ref=e86]
            - generic [ref=e88]:
              - img [ref=e89]
              - textbox "Search schema..." [ref=e91]
          - generic [ref=e92]:
            - generic [ref=e93]:
              - generic [ref=e94] [cursor=pointer]:
                - generic [ref=e95]:
                  - img [ref=e96]
                  - heading "Tables" [level=3] [ref=e98]
                  - generic [ref=e99]: (5)
                - generic [ref=e100]:
                  - button "Sort alphabetically" [ref=e101]:
                    - img [ref=e102]
                  - button "Sort by row count" [ref=e104]:
                    - img [ref=e105]
                  - img [ref=e107]
              - list [ref=e110]:
                - listitem [ref=e111]:
                  - button "GarbageCollection 20" [ref=e112]:
                    - img [ref=e113]
                    - generic [ref=e115]: GarbageCollection
                    - generic [ref=e116]: "20"
                - listitem [ref=e117]:
                  - button "GCHeapSummary 40" [ref=e118]:
                    - img [ref=e119]
                    - generic [ref=e121]: GCHeapSummary
                    - generic [ref=e122]: "40"
                - listitem [ref=e123]:
                  - button "GCPhasePause 40" [ref=e124]:
                    - img [ref=e125]
                    - generic [ref=e127]: GCPhasePause
                    - generic [ref=e128]: "40"
                - listitem [ref=e129]:
                  - button "HeapSnapshot 150" [ref=e130]:
                    - img [ref=e131]
                    - generic [ref=e133]: HeapSnapshot
                    - generic [ref=e134]: "150"
                - listitem [ref=e135]:
                  - button "ObjectAllocationSample 25" [ref=e136]:
                    - img [ref=e137]
                    - generic [ref=e139]: ObjectAllocationSample
                    - generic [ref=e140]: "25"
            - generic [ref=e142]:
              - generic [ref=e143] [cursor=pointer]:
                - generic [ref=e144]:
                  - img [ref=e145]
                  - heading "Views" [level=3] [ref=e147]
                  - generic [ref=e148]: (14)
                - generic [ref=e149]:
                  - button "Show Internal Views" [ref=e150]:
                    - img [ref=e151]
                  - img [ref=e154]
              - list [ref=e157]:
                - listitem [ref=e158]:
                  - button "allocation-by-class-detail" [ref=e159]:
                    - img [ref=e160]
                    - generic [ref=e162]: allocation-by-class-detail
                - listitem [ref=e163]:
                  - button "allocation-rate" [ref=e164]:
                    - img [ref=e165]
                    - generic [ref=e167]: allocation-rate
                - listitem [ref=e168]:
                  - button "gc" [ref=e169]:
                    - img [ref=e170]
                    - generic [ref=e172]: gc
                - listitem [ref=e173]:
                  - button "gc-concurrent-phases-detail" [ref=e174]:
                    - img [ref=e175]
                    - generic [ref=e177]: gc-concurrent-phases-detail
                - listitem [ref=e178]:
                  - button "gc-efficiency" [ref=e179]:
                    - img [ref=e180]
                    - generic [ref=e182]: gc-efficiency
                - listitem [ref=e183]:
                  - button "gc-overhead" [ref=e184]:
                    - img [ref=e185]
                    - generic [ref=e187]: gc-overhead
                - listitem [ref=e188]:
                  - button "gc-pause-distribution" [ref=e189]:
                    - img [ref=e190]
                    - generic [ref=e192]: gc-pause-distribution
                - listitem [ref=e193]:
                  - button "gc-pauses" [ref=e194]:
                    - img [ref=e195]
                    - generic [ref=e197]: gc-pauses
                - listitem [ref=e198]:
                  - button "gc-phase-breakdown" [ref=e199]:
                    - img [ref=e200]
                    - generic [ref=e202]: gc-phase-breakdown
                - listitem [ref=e203]:
                  - button "gc-throughput" [ref=e204]:
                    - img [ref=e205]
                    - generic [ref=e207]: gc-throughput
                - listitem [ref=e208]:
                  - button "gc-top-pauses" [ref=e209]:
                    - img [ref=e210]
                    - generic [ref=e212]: gc-top-pauses
                - listitem [ref=e213]:
                  - button "gc-young-vs-old" [ref=e214]:
                    - img [ref=e215]
                    - generic [ref=e217]: gc-young-vs-old
                - listitem [ref=e218]:
                  - button "heap-committed-vs-used" [ref=e219]:
                    - img [ref=e220]
                    - generic [ref=e222]: heap-committed-vs-used
                - listitem [ref=e223]:
                  - button "heap-summary-over-time" [ref=e224]:
                    - img [ref=e225]
                    - generic [ref=e227]: heap-summary-over-time
            - generic [ref=e229]:
              - generic [ref=e230] [cursor=pointer]:
                - generic [ref=e231]:
                  - img [ref=e232]
                  - heading "Macros" [level=3] [ref=e234]
                  - generic [ref=e235]: (29)
                - img [ref=e237]
              - list [ref=e240]:
                - listitem [ref=e241]:
                  - button "after_gc" [ref=e242]:
                    - img [ref=e243]
                    - generic [ref=e245]: after_gc
                - listitem [ref=e246]:
                  - button "before_gc" [ref=e247]:
                    - img [ref=e248]
                    - generic [ref=e250]: before_gc
                - listitem [ref=e251]:
                  - button "view_sql" [ref=e252]:
                    - img [ref=e253]
                    - generic [ref=e255]: view_sql
                - listitem [ref=e256]:
                  - button "time_since" [ref=e257]:
                    - img [ref=e258]
                    - generic [ref=e260]: time_since
                - listitem [ref=e261]:
                  - button "rolling_sum" [ref=e262]:
                    - img [ref=e263]
                    - generic [ref=e265]: rolling_sum
                - listitem [ref=e266]:
                  - button "rolling_avg" [ref=e267]:
                    - img [ref=e268]
                    - generic [ref=e270]: rolling_avg
                - listitem [ref=e271]:
                  - button "relative_ms" [ref=e272]:
                    - img [ref=e273]
                    - generic [ref=e275]: relative_ms
                - listitem [ref=e276]:
                  - button "recording_start" [ref=e277]:
                    - img [ref=e278]
                    - generic [ref=e280]: recording_start
                - listitem [ref=e281]:
                  - button "recording_end" [ref=e282]:
                    - img [ref=e283]
                    - generic [ref=e285]: recording_end
                - listitem [ref=e286]:
                  - button "P999" [ref=e287]:
                    - img [ref=e288]
                    - generic [ref=e290]: P999
                - listitem [ref=e291]:
                  - button "P99" [ref=e292]:
                    - img [ref=e293]
                    - generic [ref=e295]: P99
                - listitem [ref=e296]:
                  - button "P95" [ref=e297]:
                    - img [ref=e298]
                    - generic [ref=e300]: P95
                - listitem [ref=e301]:
                  - button "P90" [ref=e302]:
                    - img [ref=e303]
                    - generic [ref=e305]: P90
                - listitem [ref=e306]:
                  - button "normalized" [ref=e307]:
                    - img [ref=e308]
                    - generic [ref=e310]: normalized
                - listitem [ref=e311]:
                  - button "macro_sql" [ref=e312]:
                    - img [ref=e313]
                    - generic [ref=e315]: macro_sql
                - listitem [ref=e316]:
                  - button "in_range" [ref=e317]:
                    - img [ref=e318]
                    - generic [ref=e320]: in_range
                - listitem [ref=e321]:
                  - button "HEAP_BEFORE_GC" [ref=e322]:
                    - img [ref=e323]
                    - generic [ref=e325]: HEAP_BEFORE_GC
                - listitem [ref=e326]:
                  - button "HEAP_AFTER_GC" [ref=e327]:
                    - img [ref=e328]
                    - generic [ref=e330]: HEAP_AFTER_GC
                - listitem [ref=e331]:
                  - button "format_percentage" [ref=e332]:
                    - img [ref=e333]
                    - generic [ref=e335]: format_percentage
                - listitem [ref=e336]:
                  - button "format_memory" [ref=e337]:
                    - img [ref=e338]
                    - generic [ref=e340]: format_memory
                - listitem [ref=e341]:
                  - button "format_human_duration" [ref=e342]:
                    - img [ref=e343]
                    - generic [ref=e345]: format_human_duration
                - listitem [ref=e346]:
                  - button "format_hex" [ref=e347]:
                    - img [ref=e348]
                    - generic [ref=e350]: format_hex
                - listitem [ref=e351]:
                  - button "format_duration" [ref=e352]:
                    - img [ref=e353]
                    - generic [ref=e355]: format_duration
                - listitem [ref=e356]:
                  - button "format_decimals" [ref=e357]:
                    - img [ref=e358]
                    - generic [ref=e360]: format_decimals
                - listitem [ref=e361]:
                  - button "duration_since_last_gc" [ref=e362]:
                    - img [ref=e363]
                    - generic [ref=e365]: duration_since_last_gc
                - listitem [ref=e366]:
                  - button "diff" [ref=e367]:
                    - img [ref=e368]
                    - generic [ref=e370]: diff
                - listitem [ref=e371]:
                  - button "COUNT_UNIQUE" [ref=e372]:
                    - img [ref=e373]
                    - generic [ref=e375]: COUNT_UNIQUE
                - listitem [ref=e376]:
                  - button "bucket_ms" [ref=e377]:
                    - img [ref=e378]
                    - generic [ref=e380]: bucket_ms
                - listitem [ref=e381]:
                  - button "stack_frames" [ref=e382]:
                    - img [ref=e383]
                    - generic [ref=e385]: stack_frames
            - generic [ref=e387]:
              - generic [ref=e388] [cursor=pointer]:
                - generic [ref=e389]:
                  - img [ref=e390]
                  - heading "Preview" [level=3] [ref=e392]
                - generic [ref=e393]:
                  - button "Show Search" [ref=e394]:
                    - img [ref=e395]
                  - button "Show Query Editor" [ref=e397]:
                    - img [ref=e398]
                  - img [ref=e400]
              - table [ref=e407]:
                - rowgroup [ref=e408]:
                  - row "gcId name startTime duration ⏱ sumOfPauses ⏱ longestPause ⏱ cause" [ref=e409]:
                    - columnheader "gcId" [ref=e410]:
                      - button "gcId" [ref=e411]
                    - columnheader "name" [ref=e413]:
                      - button "name" [ref=e414]
                    - columnheader "startTime" [ref=e416]:
                      - button "startTime" [ref=e417]
                    - columnheader "duration ⏱" [ref=e419]:
                      - button "duration ⏱" [ref=e420]:
                        - text: duration
                        - generic [ref=e421]: ⏱
                    - columnheader "sumOfPauses ⏱" [ref=e423]:
                      - button "sumOfPauses ⏱" [ref=e424]:
                        - text: sumOfPauses
                        - generic [ref=e425]: ⏱
                    - columnheader "longestPause ⏱" [ref=e427]:
                      - button "longestPause ⏱" [ref=e428]:
                        - text: longestPause
                        - generic [ref=e429]: ⏱
                    - columnheader "cause" [ref=e431]:
                      - button "cause" [ref=e432]
                - rowgroup [ref=e434]:
                  - row "1 G1GC 11:00:01.20 12 ms 12 ms 11.8 ms G1 Evacuation Pause" [ref=e435]:
                    - cell "1" [ref=e436]
                    - cell "G1GC" [ref=e437]
                    - cell "11:00:01.20" [ref=e438]
                    - cell "12 ms" [ref=e439]
                    - cell "12 ms" [ref=e440]
                    - cell "11.8 ms" [ref=e441]
                    - cell "G1 Evacuation Pause" [ref=e442]
                  - row "2 G1GC 11:00:03.45 8.5 ms 8.5 ms 8.3 ms G1 Evacuation Pause" [ref=e443]:
                    - cell "2" [ref=e444]
                    - cell "G1GC" [ref=e445]
                    - cell "11:00:03.45" [ref=e446]
                    - cell "8.5 ms" [ref=e447]
                    - cell "8.5 ms" [ref=e448]
                    - cell "8.3 ms" [ref=e449]
                    - cell "G1 Evacuation Pause" [ref=e450]
                  - row "3 G1GC 11:00:05.80 21.4 ms 21.4 ms 21.1 ms G1 Humongous Allocation" [ref=e451]:
                    - cell "3" [ref=e452]
                    - cell "G1GC" [ref=e453]
                    - cell "11:00:05.80" [ref=e454]
                    - cell "21.4 ms" [ref=e455]
                    - cell "21.4 ms" [ref=e456]
                    - cell "21.1 ms" [ref=e457]
                    - cell "G1 Humongous Allocation" [ref=e458]
                  - row "4 G1GC 11:00:08.10 9.2 ms 9.2 ms 9 ms G1 Evacuation Pause" [ref=e459]:
                    - cell "4" [ref=e460]
                    - cell "G1GC" [ref=e461]
                    - cell "11:00:08.10" [ref=e462]
                    - cell "9.2 ms" [ref=e463]
                    - cell "9.2 ms" [ref=e464]
                    - cell "9 ms" [ref=e465]
                    - cell "G1 Evacuation Pause" [ref=e466]
                  - row "5 G1GC 11:00:12.60 15.6 ms 15.6 ms 15.4 ms G1 Evacuation Pause" [ref=e467]:
                    - cell "5" [ref=e468]
                    - cell "G1GC" [ref=e469]
                    - cell "11:00:12.60" [ref=e470]
                    - cell "15.6 ms" [ref=e471]
                    - cell "15.6 ms" [ref=e472]
                    - cell "15.4 ms" [ref=e473]
                    - cell "G1 Evacuation Pause" [ref=e474]
                  - row "6 G1GC 11:00:16.30 142 ms 142 ms 141.5 ms G1 Concurrent GC" [ref=e475]:
                    - cell "6" [ref=e476]
                    - cell "G1GC" [ref=e477]
                    - cell "11:00:16.30" [ref=e478]
                    - cell "142 ms" [ref=e479]
                    - cell "142 ms" [ref=e480]
                    - cell "141.5 ms" [ref=e481]
                    - cell "G1 Concurrent GC" [ref=e482]
                  - row "7 G1GC 11:00:19.70 7.5 ms 7.5 ms 7.3 ms G1 Evacuation Pause" [ref=e483]:
                    - cell "7" [ref=e484]
                    - cell "G1GC" [ref=e485]
                    - cell "11:00:19.70" [ref=e486]
                    - cell "7.5 ms" [ref=e487]
                    - cell "7.5 ms" [ref=e488]
                    - cell "7.3 ms" [ref=e489]
                    - cell "G1 Evacuation Pause" [ref=e490]
                  - row "8 G1GC 11:00:23.40 9.8 ms 9.8 ms 9.6 ms G1 Evacuation Pause" [ref=e491]:
                    - cell "8" [ref=e492]
                    - cell "G1GC" [ref=e493]
                    - cell "11:00:23.40" [ref=e494]
                    - cell "9.8 ms" [ref=e495]
                    - cell "9.8 ms" [ref=e496]
                    - cell "9.6 ms" [ref=e497]
                    - cell "G1 Evacuation Pause" [ref=e498]
                  - row "9 G1GC 11:00:27.80 18.3 ms 18.3 ms 18 ms G1 Evacuation Pause" [ref=e499]:
                    - cell "9" [ref=e500]
                    - cell "G1GC" [ref=e501]
                    - cell "11:00:27.80" [ref=e502]
                    - cell "18.3 ms" [ref=e503]
                    - cell "18.3 ms" [ref=e504]
                    - cell "18 ms" [ref=e505]
                    - cell "G1 Evacuation Pause" [ref=e506]
                  - row "10 G1GC 11:00:30.10 6.7 ms 6.7 ms 6.5 ms G1 Evacuation Pause" [ref=e507]:
                    - cell "10" [ref=e508]
                    - cell "G1GC" [ref=e509]
                    - cell "11:00:30.10" [ref=e510]
                    - cell "6.7 ms" [ref=e511]
                    - cell "6.7 ms" [ref=e512]
                    - cell "6.5 ms" [ref=e513]
                    - cell "G1 Evacuation Pause" [ref=e514]
                  - row "11 G1GC 11:00:34.50 24.3 ms 24.3 ms 23.9 ms G1 Humongous Allocation" [ref=e515]:
                    - cell "11" [ref=e516]
                    - cell "G1GC" [ref=e517]
                    - cell "11:00:34.50" [ref=e518]
                    - cell "24.3 ms" [ref=e519]
                    - cell "24.3 ms" [ref=e520]
                    - cell "23.9 ms" [ref=e521]
                    - cell "G1 Humongous Allocation" [ref=e522]
                  - row "12 G1GC 11:00:39.20 8.9 ms 8.9 ms 8.7 ms G1 Evacuation Pause" [ref=e523]:
                    - cell "12" [ref=e524]
                    - cell "G1GC" [ref=e525]
                    - cell "11:00:39.20" [ref=e526]
                    - cell "8.9 ms" [ref=e527]
                    - cell "8.9 ms" [ref=e528]
                    - cell "8.7 ms" [ref=e529]
                    - cell "G1 Evacuation Pause" [ref=e530]
                  - row "13 G1GC 11:00:43.70 189 ms 189 ms 188.5 ms G1 Concurrent GC" [ref=e531]:
                    - cell "13" [ref=e532]
                    - cell "G1GC" [ref=e533]
                    - cell "11:00:43.70" [ref=e534]
                    - cell "189 ms" [ref=e535]
                    - cell "189 ms" [ref=e536]
                    - cell "188.5 ms" [ref=e537]
                    - cell "G1 Concurrent GC" [ref=e538]
                  - row "14 G1GC 11:00:47.10 11.5 ms 11.5 ms 11.3 ms G1 Evacuation Pause" [ref=e539]:
                    - cell "14" [ref=e540]
                    - cell "G1GC" [ref=e541]
                    - cell "11:00:47.10" [ref=e542]
                    - cell "11.5 ms" [ref=e543]
                    - cell "11.5 ms" [ref=e544]
                    - cell "11.3 ms" [ref=e545]
                    - cell "G1 Evacuation Pause" [ref=e546]
                  - row "15 G1GC 11:00:51.60 7.7 ms 7.7 ms 7.5 ms G1 Evacuation Pause" [ref=e547]:
                    - cell "15" [ref=e548]
                    - cell "G1GC" [ref=e549]
                    - cell "11:00:51.60" [ref=e550]
                    - cell "7.7 ms" [ref=e551]
                    - cell "7.7 ms" [ref=e552]
                    - cell "7.5 ms" [ref=e553]
                    - cell "G1 Evacuation Pause" [ref=e554]
                  - row "16 G1GC 11:00:54.30 20.1 ms 20.1 ms 19.8 ms G1 Evacuation Pause" [ref=e555]:
                    - cell "16" [ref=e556]
                    - cell "G1GC" [ref=e557]
                    - cell "11:00:54.30" [ref=e558]
                    - cell "20.1 ms" [ref=e559]
                    - cell "20.1 ms" [ref=e560]
                    - cell "19.8 ms" [ref=e561]
                    - cell "G1 Evacuation Pause" [ref=e562]
                  - row "17 G1GC 11:00:58.80 13.4 ms 13.4 ms 13.2 ms G1 Evacuation Pause" [ref=e563]:
                    - cell "17" [ref=e564]
                    - cell "G1GC" [ref=e565]
                    - cell "11:00:58.80" [ref=e566]
                    - cell "13.4 ms" [ref=e567]
                    - cell "13.4 ms" [ref=e568]
                    - cell "13.2 ms" [ref=e569]
                    - cell "G1 Evacuation Pause" [ref=e570]
                  - row "18 G1GC 11:01:02.40 8.8 ms 8.8 ms 8.6 ms G1 Evacuation Pause" [ref=e571]:
                    - cell "18" [ref=e572]
                    - cell "G1GC" [ref=e573]
                    - cell "11:01:02.40" [ref=e574]
                    - cell "8.8 ms" [ref=e575]
                    - cell "8.8 ms" [ref=e576]
                    - cell "8.6 ms" [ref=e577]
                    - cell "G1 Evacuation Pause" [ref=e578]
                  - row "19 G1GC 11:01:06.90 31.1 ms 31.1 ms 30.7 ms G1 Humongous Allocation" [ref=e579]:
                    - cell "19" [ref=e580]
                    - cell "G1GC" [ref=e581]
                    - cell "11:01:06.90" [ref=e582]
                    - cell "31.1 ms" [ref=e583]
                    - cell "31.1 ms" [ref=e584]
                    - cell "30.7 ms" [ref=e585]
                    - cell "G1 Humongous Allocation" [ref=e586]
                  - row "20 G1GC 11:01:11.20 225 ms 225 ms 224.4 ms G1 Concurrent GC" [ref=e587]:
                    - cell "20" [ref=e588]
                    - cell "G1GC" [ref=e589]
                    - cell "11:01:11.20" [ref=e590]
                    - cell "225 ms" [ref=e591]
                    - cell "225 ms" [ref=e592]
                    - cell "224.4 ms" [ref=e593]
                    - cell "G1 Concurrent GC" [ref=e594]
        - button "Collapse sidebar" [ref=e597]:
          - img [ref=e598]
      - main [ref=e600]:
        - generic [ref=e602]:
          - generic [ref=e604] [cursor=pointer]:
            - heading "Notebook Settings · 2 vars" [level=3] [ref=e605]:
              - img [ref=e606]
              - text: Notebook Settings
              - generic [ref=e608]: ·
              - generic [ref=e609]: 2 vars
            - img [ref=e610]
          - generic [ref=e612]:
            - generic [ref=e613]:
              - generic [ref=e614]:
                - button "Drag to reorder cell" [ref=e615]:
                  - img [ref=e616]
                - button "Collapse cell" [ref=e618]:
                  - img [ref=e619]
                - heading [level=2]
              - generic [ref=e621]:
                - button "Raw Markdown" [ref=e622]:
                  - img [ref=e623]
                - button "Delete Cell" [ref=e625]:
                  - img [ref=e626]
            - generic [ref=e628]:
              - generic [ref=e632] [cursor=pointer]:
                - heading "JFR SQL Notebook" [level=1] [ref=e633]
                - paragraph [ref=e634]: "Welcome! This notebook lets you query a loaded JFR recording (or any DuckDB database) using SQL, then visualize results as charts. Here's how it works:"
                - list [ref=e635]:
                  - listitem [ref=e636]:
                    - strong [ref=e637]: Left sidebar
                    - text: "— Schema Explorer: browse tables, views, and macros in the database. Click any item to preview it in the sidebar; double-click to copy its name to clipboard."
                  - listitem [ref=e638]:
                    - strong [ref=e639]: Each cell
                    - text: has one or more SQL queries followed by a plot config that visualizes the results. Click the
                    - strong [ref=e640]: ›
                    - text: chevron in the cell header to collapse/expand it; use
                    - strong [ref=e641]: Collapse All
                    - text: /
                    - strong [ref=e642]: Expand All
                    - text: in the toolbar.
                  - listitem [ref=e643]:
                    - strong [ref=e644]: Run
                    - text: a query with the ▶ button (or Cmd+Enter). The plot updates automatically.
                  - listitem [ref=e645]:
                    - strong [ref=e646]: Add content
                    - text: — use
                    - strong [ref=e647]: + Add SQL
                    - text: /
                    - strong [ref=e648]: + Plot
                    - text: /
                    - strong [ref=e649]: + Prose
                    - text: between blocks, or
                    - strong [ref=e650]: + Add Cell
                    - text: at the bottom.
                  - listitem [ref=e651]:
                    - strong [ref=e652]: Variables
                    - text: — declare
                    - code [ref=e653]: $name = value
                    - text: in a variables block; reference them in SQL as
                    - code [ref=e654]: $name
                    - text: . Notebook-wide variables use
                    - code [ref=e655]: $$name
                    - text: in the Settings cell.
                  - listitem [ref=e656]:
                    - strong [ref=e657]: Column chips
                    - text: appear above the plot editor — click any chip to copy the column name into your plot config.
                  - listitem [ref=e658]:
                    - strong [ref=e659]: Templates
                    - text: — click
                    - strong [ref=e660]: New from template
                    - text: in the toolbar to start from a pre-built analysis (GC, allocation, threading, exceptions).
                  - listitem [ref=e661]:
                    - strong [ref=e662]: AI assistant
                    - text: — the panel on the right answers questions and writes SQL. Click the speech-bubble icon on any query to open a per-cell chat.
              - generic [ref=e664]:
                - button "Add variable" [ref=e665]:
                  - img [ref=e666]
                  - text: Add variable
                - button "Add Plot" [ref=e668]:
                  - img [ref=e669]
                  - text: Add Plot
                - button "Add SQL" [ref=e671]:
                  - img [ref=e672]
                  - text: Add SQL
              - button "Add Conclusion" [ref=e675]:
                - img [ref=e676]
                - text: Add Conclusion
          - generic [ref=e678]:
            - generic [ref=e679]:
              - generic [ref=e680]:
                - button "Drag to reorder cell" [ref=e681]:
                  - img [ref=e682]
                - button "Collapse cell" [ref=e684]:
                  - img [ref=e685]
                - heading "Step 1 — Your first query" [level=2] [ref=e687] [cursor=pointer]
              - generic [ref=e688]:
                - button "Raw Markdown" [ref=e689]:
                  - img [ref=e690]
                - button "Delete Cell" [ref=e692]:
                  - img [ref=e693]
            - generic [ref=e695]:
              - paragraph [ref=e700] [cursor=pointer]:
                - text: Click
                - strong [ref=e701]: ▶
                - text: below to run this query. It returns the 10 longest GC pauses. The result appears in the table.
              - generic [ref=e702]:
                - generic [ref=e703]:
                  - generic [ref=e704]:
                    - generic [ref=e705] [cursor=pointer]:
                      - img [ref=e706]
                      - generic [ref=e709]:
                        - generic "Click to rename" [ref=e710]: Query 1
                        - generic "Query execution time" [ref=e711]: 6ms
                      - generic [ref=e712]: SELECT "startTime", round(duration * 1000, 3) AS "duration_m
                    - generic [ref=e713]:
                      - button "Run query (Cmd+Enter)" [ref=e714]:
                        - img [ref=e715]
                      - button "Format SQL" [ref=e717]:
                        - img [ref=e718]
                      - button "Suggest plot with AI" [ref=e721]:
                        - img [ref=e722]
                      - button "Refine with AI" [ref=e724]:
                        - img [ref=e725]
                      - button "Copy SQL" [ref=e728]:
                        - img [ref=e729]
                      - button "Delete query block" [ref=e731]:
                        - img [ref=e732]
                  - textbox [ref=e738]:
                    - generic [ref=e739]: SELECT
                    - generic [ref=e740]: "\"startTime\","
                    - generic [ref=e741]: round(duration * 1000, 3) AS "duration_ms",
                    - generic [ref=e742]: "\"cause\""
                    - generic [ref=e743]: FROM "GarbageCollection"
                    - generic [ref=e744]: ORDER BY duration DESC
                    - generic [ref=e745]: LIMIT 10;
                - generic [ref=e748]:
                  - button "+ SQL" [ref=e749]
                  - button "+ Plot" [ref=e750]
                  - button "+ Prose" [ref=e751]
                - generic [ref=e752]:
                  - generic [ref=e753]:
                    - generic [ref=e754] [cursor=pointer]:
                      - img [ref=e755]
                      - generic [ref=e757]: Plot 1
                      - generic [ref=e758]: TABLE()
                    - generic [ref=e759]:
                      - button "Format plot" [ref=e760]:
                        - img [ref=e761]
                      - button "Generate plot config with AI" [ref=e764]:
                        - img [ref=e765]
                      - button "Refine with AI" [ref=e767]:
                        - img [ref=e768]
                      - button "Plot syntax reference" [ref=e771]:
                        - img [ref=e772]
                      - button "Delete plot block" [ref=e774]:
                        - img [ref=e775]
                  - generic [ref=e777]:
                    - generic [ref=e778]:
                      - generic [ref=e779]: "columns:"
                      - button "startTime" [ref=e780]
                      - button "duration_ms" [ref=e781]
                      - button "cause" [ref=e782]
                      - generic [ref=e783]: — click to copy
                    - textbox [ref=e788]:
                      - generic [ref=e789]: TABLE()
                - generic [ref=e790]:
                  - button "Download as PNG" [ref=e791]:
                    - img [ref=e792]
                  - generic [ref=e802]:
                    - generic [ref=e803]:
                      - generic [ref=e804]:
                        - img [ref=e805]
                        - textbox "Search..." [ref=e807]
                      - generic [ref=e808]: 10 rows
                      - button "CSV ↓" [ref=e809]
                    - table [ref=e811]:
                      - rowgroup [ref=e812]:
                        - row "startTime duration_ms ⏱ cause" [ref=e813]:
                          - columnheader "startTime" [ref=e814]:
                            - button "startTime" [ref=e815]
                          - columnheader "duration_ms ⏱" [ref=e817]:
                            - button "duration_ms ⏱" [ref=e818]:
                              - text: duration_ms
                              - generic [ref=e819]: ⏱
                          - columnheader "cause" [ref=e821]:
                            - button "cause" [ref=e822]
                      - rowgroup [ref=e824]:
                        - row "11:01:11.20 225 ms G1 Concurrent GC" [ref=e825]:
                          - cell "11:01:11.20" [ref=e826]
                          - cell "225 ms" [ref=e827]
                          - cell "G1 Concurrent GC" [ref=e828]
                        - row "11:00:43.70 189 ms G1 Concurrent GC" [ref=e829]:
                          - cell "11:00:43.70" [ref=e830]
                          - cell "189 ms" [ref=e831]
                          - cell "G1 Concurrent GC" [ref=e832]
                        - row "11:00:16.30 142 ms G1 Concurrent GC" [ref=e833]:
                          - cell "11:00:16.30" [ref=e834]
                          - cell "142 ms" [ref=e835]
                          - cell "G1 Concurrent GC" [ref=e836]
                        - row "11:01:06.90 31.1 ms G1 Humongous Allocation" [ref=e837]:
                          - cell "11:01:06.90" [ref=e838]
                          - cell "31.1 ms" [ref=e839]
                          - cell "G1 Humongous Allocation" [ref=e840]
                        - row "11:00:34.50 24.3 ms G1 Humongous Allocation" [ref=e841]:
                          - cell "11:00:34.50" [ref=e842]
                          - cell "24.3 ms" [ref=e843]
                          - cell "G1 Humongous Allocation" [ref=e844]
                        - row "11:00:05.80 21.4 ms G1 Humongous Allocation" [ref=e845]:
                          - cell "11:00:05.80" [ref=e846]
                          - cell "21.4 ms" [ref=e847]
                          - cell "G1 Humongous Allocation" [ref=e848]
                        - row "11:00:54.30 20.1 ms G1 Evacuation Pause" [ref=e849]:
                          - cell "11:00:54.30" [ref=e850]
                          - cell "20.1 ms" [ref=e851]
                          - cell "G1 Evacuation Pause" [ref=e852]
                        - row "11:00:27.80 18.3 ms G1 Evacuation Pause" [ref=e853]:
                          - cell "11:00:27.80" [ref=e854]
                          - cell "18.3 ms" [ref=e855]
                          - cell "G1 Evacuation Pause" [ref=e856]
                        - row "11:00:12.60 15.6 ms G1 Evacuation Pause" [ref=e857]:
                          - cell "11:00:12.60" [ref=e858]
                          - cell "15.6 ms" [ref=e859]
                          - cell "G1 Evacuation Pause" [ref=e860]
                        - row "11:00:58.80 13.4 ms G1 Evacuation Pause" [ref=e861]:
                          - cell "11:00:58.80" [ref=e862]
                          - cell "13.4 ms" [ref=e863]
                          - cell "G1 Evacuation Pause" [ref=e864]
                - generic [ref=e865]:
                  - button "Add variable" [ref=e866]:
                    - img [ref=e867]
                    - text: Add variable
                  - button "Add Plot" [ref=e869]:
                    - img [ref=e870]
                    - text: Add Plot
                  - button "Add SQL" [ref=e872]:
                    - img [ref=e873]
                    - text: Add SQL
                - generic "Drag to resize results" [ref=e875]
              - button "Add Conclusion" [ref=e877]:
                - img [ref=e878]
                - text: Add Conclusion
          - generic [ref=e880]:
            - generic [ref=e881]:
              - generic [ref=e882]:
                - button "Drag to reorder cell" [ref=e883]:
                  - img [ref=e884]
                - button "Collapse cell" [ref=e886]:
                  - img [ref=e887]
                - heading "Step 2 — Visualize as a chart" [level=2] [ref=e889] [cursor=pointer]
              - generic [ref=e890]:
                - button "Raw Markdown" [ref=e891]:
                  - img [ref=e892]
                - button "Delete Cell" [ref=e894]:
                  - img [ref=e895]
            - generic [ref=e897]:
              - paragraph [ref=e902] [cursor=pointer]:
                - text: Change the plot config from
                - code [ref=e903]: TABLE()
                - text: to a
                - code [ref=e904]: BAR_CHART
                - text: to compare pause durations by GC cause. The x-axis is the category, y is the numeric value. You can edit the plot config directly — column chips above the editor show available columns.
              - generic [ref=e905]:
                - generic [ref=e906]:
                  - generic [ref=e907]:
                    - generic [ref=e908] [cursor=pointer]:
                      - img [ref=e909]
                      - generic [ref=e912]:
                        - generic "Click to rename" [ref=e913]: Query 1
                        - generic "Query execution time" [ref=e914]: 17ms
                      - generic [ref=e915]: SELECT "cause", COUNT(*) AS "count", round(AVG(duration * 10
                    - generic [ref=e916]:
                      - button "Run query (Cmd+Enter)" [ref=e917]:
                        - img [ref=e918]
                      - button "Format SQL" [ref=e920]:
                        - img [ref=e921]
                      - button "Suggest plot with AI" [ref=e924]:
                        - img [ref=e925]
                      - button "Refine with AI" [ref=e927]:
                        - img [ref=e928]
                      - button "Copy SQL" [ref=e931]:
                        - img [ref=e932]
                      - button "Delete query block" [ref=e934]:
                        - img [ref=e935]
                  - textbox [ref=e941]:
                    - generic [ref=e942]: SELECT
                    - generic [ref=e943]: "\"cause\","
                    - generic [ref=e944]: COUNT(*) AS "count",
                    - generic [ref=e945]: round(AVG(duration * 1000), 3) AS "avg_ms"
                    - generic [ref=e946]: FROM "GarbageCollection"
                    - generic [ref=e947]: GROUP BY "cause"
                    - generic [ref=e948]: ORDER BY "count" DESC;
                - generic [ref=e951]:
                  - button "+ SQL" [ref=e952]
                  - button "+ Plot" [ref=e953]
                  - button "+ Prose" [ref=e954]
                - generic [ref=e955]:
                  - generic [ref=e956]:
                    - generic [ref=e957] [cursor=pointer]:
                      - img [ref=e958]
                      - generic [ref=e960]: Plot 1
                      - generic [ref=e961]: "BAR_CHART(x: \"cause\", y: [\"count\", \"avg_ms\"], layout: \"group"
                    - generic [ref=e962]:
                      - button "Format plot" [ref=e963]:
                        - img [ref=e964]
                      - button "Generate plot config with AI" [ref=e967]:
                        - img [ref=e968]
                      - button "Refine with AI" [ref=e970]:
                        - img [ref=e971]
                      - button "Plot syntax reference" [ref=e974]:
                        - img [ref=e975]
                      - button "Delete plot block" [ref=e977]:
                        - img [ref=e978]
                  - generic [ref=e980]:
                    - generic [ref=e981]:
                      - generic [ref=e982]: "columns:"
                      - button "cause" [ref=e983]
                      - button "count" [ref=e984]
                      - button "avg_ms" [ref=e985]
                      - generic [ref=e986]: — click to copy
                    - textbox [ref=e991]:
                      - generic [ref=e992]: "BAR_CHART(x: \"cause\", y: [\"count\", \"avg_ms\"], layout: \"grouped\") TITLE \"GC Causes\""
                - generic [ref=e993]:
                  - button "Download as PNG" [ref=e994]:
                    - img [ref=e995]
                  - generic [ref=e1001]:
                    - heading "GC Causes" [level=4] [ref=e1002]
                    - generic [ref=e1008]:
                      - list [ref=e1010]:
                        - listitem [ref=e1011]:
                          - img "avg ms legend icon" [ref=e1012]
                          - text: avg ms
                        - listitem [ref=e1014]:
                          - img "count legend icon" [ref=e1015]
                          - text: count
                      - application [ref=e1017]:
                        - generic [ref=e1044]:
                          - generic [ref=e1045]:
                            - generic [ref=e1047]: G1 Evacuation Pause
                            - generic [ref=e1049]: G1 Humongous Allocation
                            - generic [ref=e1051]: G1 Concurrent GC
                          - generic [ref=e1052]:
                            - generic [ref=e1054]: "3"
                            - generic [ref=e1056]: "103"
                            - generic [ref=e1058]: "185.333"
                - generic [ref=e1059]:
                  - button "Add variable" [ref=e1060]:
                    - img [ref=e1061]
                    - text: Add variable
                  - button "Add Plot" [ref=e1063]:
                    - img [ref=e1064]
                    - text: Add Plot
                  - button "Add SQL" [ref=e1066]:
                    - img [ref=e1067]
                    - text: Add SQL
                - generic "Drag to resize results" [ref=e1069]
              - button "Add Conclusion" [ref=e1071]:
                - img [ref=e1072]
                - text: Add Conclusion
          - generic [ref=e1074]:
            - generic [ref=e1075]:
              - generic [ref=e1076]:
                - button "Drag to reorder cell" [ref=e1077]:
                  - img [ref=e1078]
                - button "Collapse cell" [ref=e1080]:
                  - img [ref=e1081]
                - heading "Step 3 — Time series with zoom" [level=2] [ref=e1083] [cursor=pointer]
              - generic [ref=e1084]:
                - button "Raw Markdown" [ref=e1085]:
                  - img [ref=e1086]
                - button "Delete Cell" [ref=e1088]:
                  - img [ref=e1089]
            - generic [ref=e1091]:
              - paragraph [ref=e1096] [cursor=pointer]:
                - text: Use
                - code [ref=e1097]: LINE_CHART
                - text: for metrics over time.
                - code [ref=e1098]: LINK_X($start, $end)
                - text: enables interactive
                - strong [ref=e1099]: drag-to-pan
                - text: and
                - strong [ref=e1100]: Shift+scroll to zoom
                - text: . The
                - code [ref=e1101]: "200"
                - text: variable below limits rows — change the value and the query re-runs automatically.
              - generic [ref=e1102]:
                - generic [ref=e1103]:
                  - generic [ref=e1104] [cursor=pointer]:
                    - img [ref=e1105]
                    - generic [ref=e1107]: Variables (1)
                  - button "Add" [ref=e1109]:
                    - img [ref=e1110]
                    - text: Add
                - generic [ref=e1116]:
                  - 'textbox "Cell-local variable: must start with $ (use $$ prefix in Notebook Settings for global scope)" [ref=e1117]': $limit
                  - generic [ref=e1118]: =
                  - textbox [ref=e1119]: "200"
                  - button [ref=e1120]:
                    - img [ref=e1121]
              - generic [ref=e1123]:
                - generic [ref=e1124]:
                  - generic [ref=e1125]:
                    - generic [ref=e1126] [cursor=pointer]:
                      - img [ref=e1127]
                      - generic [ref=e1130]:
                        - generic "Click to rename" [ref=e1131]: Query 1
                        - generic "Query execution time" [ref=e1132]: 6ms
                      - generic [ref=e1133]: SELECT duration * 1000 AS duration_ms FROM GarbageCollection
                    - generic [ref=e1134]:
                      - button "Run query (Cmd+Enter)" [ref=e1135]:
                        - img [ref=e1136]
                      - button "Format SQL" [ref=e1138]:
                        - img [ref=e1139]
                      - button "Suggest plot with AI" [ref=e1142]:
                        - img [ref=e1143]
                      - button "Refine with AI" [ref=e1145]:
                        - img [ref=e1146]
                      - button "Copy SQL" [ref=e1149]:
                        - img [ref=e1150]
                      - button "Delete query block" [ref=e1152]:
                        - img [ref=e1153]
                  - textbox [ref=e1159]:
                    - generic [ref=e1160]: SELECT duration * 1000 AS duration_ms FROM GarbageCollection
                - generic [ref=e1164]:
                  - button "+ SQL" [ref=e1165]
                  - button "+ Plot" [ref=e1166]
                  - button "+ Prose" [ref=e1167]
                - generic [ref=e1168]:
                  - generic [ref=e1169]:
                    - generic [ref=e1170] [cursor=pointer]:
                      - img [ref=e1171]
                      - generic [ref=e1173]: Plot 1
                      - generic [ref=e1174]: "HISTOGRAM(x: \"duration_ms\", bins: 10) TITLE \"Duration dist\""
                    - generic [ref=e1175]:
                      - button "Format plot" [ref=e1176]:
                        - img [ref=e1177]
                      - button "Generate plot config with AI" [ref=e1180]:
                        - img [ref=e1181]
                      - button "Refine with AI" [ref=e1183]:
                        - img [ref=e1184]
                      - button "Plot syntax reference" [ref=e1187]:
                        - img [ref=e1188]
                      - button "Delete plot block" [ref=e1190]:
                        - img [ref=e1191]
                  - generic [ref=e1193]:
                    - generic [ref=e1194]:
                      - generic [ref=e1195]: "columns:"
                      - button "duration_ms" [ref=e1196]
                      - generic [ref=e1197]: — click to copy
                    - textbox [active] [ref=e1202]:
                      - generic [ref=e1203]: "HISTOGRAM(x: \"duration_ms\", bins: 10)"
                      - generic [ref=e1204]: TITLE "Duration dist"
                      - generic [ref=e1205]:
                        - generic [ref=e1206]: PALETTE
                        - text: "\"tableau10\""
                - generic [ref=e1208]:
                  - button "Download as PNG" [ref=e1209]:
                    - img [ref=e1210]
                  - generic [ref=e1216]:
                    - heading "Duration dist" [level=4] [ref=e1217]
                    - application [ref=e1224]:
                      - generic [ref=e1250]:
                        - generic [ref=e1251]:
                          - generic [ref=e1253]: 6.7-28.53
                          - generic [ref=e1255]: 28.53-50.36
                          - generic [ref=e1257]: 50.36-72.19
                          - generic [ref=e1259]: 72.19-94.02
                          - generic [ref=e1261]: 94.02-115.85
                          - generic [ref=e1263]: 115.85-137.68
                          - generic [ref=e1265]: 137.68-159.51
                          - generic [ref=e1267]: 159.51-181.34
                          - generic [ref=e1269]: 181.34-203.17
                          - generic [ref=e1271]: 203.17-225
                        - generic [ref=e1272]:
                          - generic [ref=e1274]: "0"
                          - generic [ref=e1276]: "4"
                          - generic [ref=e1278]: "8"
                          - generic [ref=e1280]: "12"
                          - generic [ref=e1282]: "16"
                        - generic [ref=e1283]: Frequency
                - generic [ref=e1284]:
                  - button "Add variable" [ref=e1285]:
                    - img [ref=e1286]
                    - text: Add variable
                  - button "Add Plot" [ref=e1288]:
                    - img [ref=e1289]
                    - text: Add Plot
                  - button "Add SQL" [ref=e1291]:
                    - img [ref=e1292]
                    - text: Add SQL
                - generic "Drag to resize results" [ref=e1294]
              - button "Add Conclusion" [ref=e1296]:
                - img [ref=e1297]
                - text: Add Conclusion
          - generic [ref=e1299]:
            - generic [ref=e1300]:
              - generic [ref=e1301]:
                - button "Drag to reorder cell" [ref=e1302]:
                  - img [ref=e1303]
                - button "Collapse cell" [ref=e1305]:
                  - img [ref=e1306]
                - heading "Step 4 — Add your own analysis" [level=2] [ref=e1308] [cursor=pointer]
              - generic [ref=e1309]:
                - button "Raw Markdown" [ref=e1310]:
                  - img [ref=e1311]
                - button "Delete Cell" [ref=e1313]:
                  - img [ref=e1314]
            - generic [ref=e1316]:
              - list [ref=e1321] [cursor=pointer]:
                - listitem [ref=e1322]:
                  - text: Click
                  - strong [ref=e1323]: + Add SQL
                  - text: below any cell to add another query, or
                  - strong [ref=e1324]: + Add Cell
                  - text: at the bottom to start fresh.
                - listitem [ref=e1325]:
                  - text: Click
                  - strong [ref=e1326]: Plot syntax
                  - text: beneath any plot block for the full chart reference (LINE_CHART, BAR_CHART, SCATTER_PLOT, HISTOGRAM, FLAMEGRAPH, and more).
                - listitem [ref=e1327]:
                  - text: Click
                  - strong [ref=e1328]: </>
                  - text: in the cell header to edit the prose above as raw Markdown.
                - listitem [ref=e1329]:
                  - text: Try the
                  - strong [ref=e1330]: Schema Explorer
                  - text: on the left — click a table to preview it, or search for a column name across all tables.
                - listitem [ref=e1331]:
                  - text: Open
                  - strong [ref=e1332]: New from template
                  - text: in the toolbar for ready-made GC, allocation, threading, and exception notebooks.
              - generic [ref=e1334]:
                - button "Add variable" [ref=e1335]:
                  - img [ref=e1336]
                  - text: Add variable
                - button "Add Plot" [ref=e1338]:
                  - img [ref=e1339]
                  - text: Add Plot
                - button "Add SQL" [ref=e1341]:
                  - img [ref=e1342]
                  - text: Add SQL
              - button "Add Conclusion" [ref=e1345]:
                - img [ref=e1346]
                - text: Add Conclusion
          - generic [ref=e1348]:
            - generic [ref=e1349]:
              - generic [ref=e1350]:
                - button "Drag to reorder cell" [ref=e1351]:
                  - img [ref=e1352]
                - button "Collapse cell" [ref=e1354]:
                  - img [ref=e1355]
                - heading "New Cell" [level=2] [ref=e1357] [cursor=pointer]
              - generic [ref=e1358]:
                - button "Raw Markdown" [ref=e1359]:
                  - img [ref=e1360]
                - button "Delete Cell" [ref=e1362]:
                  - img [ref=e1363]
            - generic [ref=e1365]:
              - button "Add Introduction" [ref=e1367]:
                - img [ref=e1368]
                - text: Add Introduction
              - generic [ref=e1371]:
                - button "Add variable" [ref=e1372]:
                  - img [ref=e1373]
                  - text: Add variable
                - button "Add Plot" [ref=e1375]:
                  - img [ref=e1376]
                  - text: Add Plot
                - button "Add SQL" [ref=e1378]:
                  - img [ref=e1379]
                  - text: Add SQL
              - button "Add Conclusion" [ref=e1382]:
                - img [ref=e1383]
                - text: Add Conclusion
          - button "Add Cell" [ref=e1386]:
            - img [ref=e1387]
            - text: Add Cell
      - generic:
        - generic:
          - generic:
            - generic:
              - generic:
                - heading "AI Assistant" [level=2]:
                  - img
                  - text: AI Assistant
                - generic:
                  - button "New chat channel":
                    - img
                  - button "Reset Conversation":
                    - img
              - generic:
                - generic: See
                - combobox "AI data visibility":
                  - option "No data" [selected]
                  - option "Sanitized"
                  - option "Full"
                - 'generic "Mode: /normal — chat normally, mutations require approval Model: t5-small-finetuned (browser) Visibility: no-data — AI sees schema only — no rows Type /help to see all slash commands."':
                  - 'combobox "Mode: /normal — chat normally, mutations require approval Switch with /normal, /plan, or /btw."':
                    - option "/normal" [selected]
                    - option "/plan"
                    - option "/btw"
                  - generic: ·
                  - 'combobox "Model: t5-small-finetuned (browser) Switch with /model <name> or /provider <name>."':
                    - option "plot-suggester-local"
                    - option "t5-small-finetuned" [selected]
                    - option "t5-small-finetuned-v2"
                    - option "flan-t5-small"
                    - option "t5-small"
                    - option "qwen2.5-0.5b"
                    - option "qwen2.5-coder-0.5b"
                    - option "smollm2-360m"
                    - option "t5-base"
            - generic:
              - generic:
                - generic:
                  - generic:
                    - paragraph: Hello! I can help you analyze your JFR data. What would you like to investigate? For example, you could ask about CPU load or garbage collection pauses.
                    - paragraph:
                      - text: Type
                      - code: /help
                      - text: to see available commands.
                  - button "Copy response":
                    - img
              - generic:
                - button "What GC events are in this recording?"
                - button "Show me the longest GC pauses"
                - button "Which threads are using the most CPU?"
                - button "Summarize memory allocation hotspots"
            - generic:
              - generic:
                - textbox "Ask for a query… or type / for commands, @ to mention a cell"
                - button [disabled]:
                  - img
      - button "Expand Assistant" [ref=e1389]:
        - img [ref=e1390]
  - generic [ref=e1392]: "4"
```

# Test source

```ts
  578 | 
  579 | // ---------------------------------------------------------------------------
  580 | // Section 13: GANTT task labels
  581 | // ---------------------------------------------------------------------------
  582 | 
  583 | test.describe.serial('Plot: GANTT task labels', () => {
  584 |   test.skip(SKIP, 'SKIP_E2E=1 set');
  585 | 
  586 |   let page: Page;
  587 | 
  588 |   test.beforeAll(async ({ browser }) => {
  589 |     page = await browser.newPage();
  590 |     await gotoDemo(page);
  591 |   });
  592 | 
  593 |   test.afterAll(async () => page.close());
  594 | 
  595 |   test('G1. GANTT with task= argument renders without error', async () => {
  596 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  597 |     await page.waitForTimeout(500);
  598 | 
  599 |     const sqlEd = await getLastSqlEditor(page);
  600 |     if (!sqlEd) { test.skip(); return; }
  601 | 
  602 |     await setCmContent(page, sqlEd, [
  603 |       `SELECT cause AS phase,`,
  604 |       `  epoch_ms(startTime) AS startTime,`,
  605 |       `  epoch_ms(startTime) + (duration * 1000) AS endTime,`,
  606 |       `  cause AS lane,`,
  607 |       `  cause AS task_label`,
  608 |       `FROM GarbageCollection ORDER BY startTime LIMIT 10`,
  609 |     ].join('\n'));
  610 |     await pressRun(page);
  611 |     await page.waitForTimeout(1500);
  612 | 
  613 |     const plotEd = await getLastPlotEditor(page);
  614 |     if (!plotEd) { test.skip(); return; }
  615 | 
  616 |     await setCmContent(page, plotEd,
  617 |       'GANTT(start: "startTime", end: "endTime", lane: "lane", task: "task_label")\n  TITLE "GC Timeline"');
  618 |     await pressRun(page);
  619 |     await page.waitForTimeout(2000);
  620 | 
  621 |     const container = page.locator('div[id^="result-container-"]').last();
  622 |     await expect(container).toBeVisible({ timeout: 10_000 });
  623 | 
  624 |     // Chart title confirms correct render
  625 |     await expect(container.locator('text=GC Timeline')).toBeVisible({ timeout: 5_000 });
  626 |   });
  627 | });
  628 | 
  629 | // ---------------------------------------------------------------------------
  630 | // Section 14: HISTOGRAM PALETTE clause
  631 | // ---------------------------------------------------------------------------
  632 | 
  633 | test.describe.serial('Plot: HISTOGRAM PALETTE clause', () => {
  634 |   test.skip(SKIP, 'SKIP_E2E=1 set');
  635 | 
  636 |   let page: Page;
  637 | 
  638 |   test.beforeAll(async ({ browser }) => {
  639 |     page = await browser.newPage();
  640 |     await gotoDemo(page);
  641 |   });
  642 | 
  643 |   test.afterAll(async () => page.close());
  644 | 
  645 |   test('H1. HISTOGRAM with PALETTE renders bar with palette color (not default purple)', async () => {
  646 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  647 |     await page.waitForTimeout(500);
  648 | 
  649 |     const sqlEd = await getLastSqlEditor(page);
  650 |     if (!sqlEd) { test.skip(); return; }
  651 | 
  652 |     await setCmContent(page, sqlEd,
  653 |       `SELECT duration * 1000 AS duration_ms FROM GarbageCollection`);
  654 |     await pressRun(page);
  655 |     await page.waitForTimeout(1500);
  656 | 
  657 |     const plotEd = await getLastPlotEditor(page);
  658 |     if (!plotEd) { test.skip(); return; }
  659 | 
  660 |     await setCmContent(page, plotEd,
  661 |       'HISTOGRAM(x: "duration_ms", bins: 10)\n  TITLE "Duration dist"\n  PALETTE "tableau10"');
  662 |     await pressRun(page);
  663 |     await page.waitForTimeout(2000);
  664 | 
  665 |     const container = page.locator('div[id^="result-container-"]').last();
  666 |     await expect(container).toBeVisible({ timeout: 10_000 });
  667 | 
  668 |     // tableau10 first color is #4e79a7 (steel blue), NOT the default #8884d8 (purple)
  669 |     const barFill = await page.evaluate(() => {
  670 |       const bars = document.querySelectorAll('.recharts-bar-rectangle rect, .recharts-rectangle');
  671 |       for (const bar of Array.from(bars)) {
  672 |         const fill = bar.getAttribute('fill') || window.getComputedStyle(bar).fill;
  673 |         if (fill && fill !== 'none') return fill;
  674 |       }
  675 |       return null;
  676 |     });
  677 |     // Should not be the default purple #8884d8
> 678 |     expect(barFill).not.toBe('#8884d8');
      |                         ^ Error: expect(received).not.toBe(expected) // Object.is equality
  679 |     expect(barFill).not.toBeNull();
  680 |   });
  681 | });
  682 | 
  683 | // ---------------------------------------------------------------------------
  684 | // Section 15: FLAMEGRAPH HEIGHT clause
  685 | // ---------------------------------------------------------------------------
  686 | 
  687 | test.describe.serial('Plot: FLAMEGRAPH HEIGHT clause', () => {
  688 |   test.skip(SKIP, 'SKIP_E2E=1 set');
  689 | 
  690 |   let page: Page;
  691 | 
  692 |   test.beforeAll(async ({ browser }) => {
  693 |     page = await browser.newPage();
  694 |     await gotoDemo(page);
  695 |   });
  696 | 
  697 |   test.afterAll(async () => page.close());
  698 | 
  699 |   test('F1. FLAMEGRAPH with HEIGHT clause sets container height', async () => {
  700 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  701 |     await page.waitForTimeout(500);
  702 | 
  703 |     const sqlEd = await getLastSqlEditor(page);
  704 |     if (!sqlEd) { test.skip(); return; }
  705 | 
  706 |     await setCmContent(page, sqlEd, [
  707 |       `SELECT 'JVM;GC;' || cause AS frames,`,
  708 |       `  CAST(duration * 1000 AS INTEGER) AS weight`,
  709 |       `FROM GarbageCollection LIMIT 20`,
  710 |     ].join('\n'));
  711 |     await pressRun(page);
  712 |     await page.waitForTimeout(1500);
  713 | 
  714 |     const plotEd = await getLastPlotEditor(page);
  715 |     if (!plotEd) { test.skip(); return; }
  716 | 
  717 |     await setCmContent(page, plotEd,
  718 |       'FLAMEGRAPH(frames: "frames", value: "weight")\n  TITLE "FG height test"\n  HEIGHT 250px');
  719 |     await pressRun(page);
  720 |     await page.waitForTimeout(3000);
  721 | 
  722 |     const container = page.locator('div[id^="result-container-"]').last();
  723 |     await expect(container).toBeVisible({ timeout: 10_000 });
  724 | 
  725 |     // The flamegraph container should have ~250px height
  726 |     const height = await page.evaluate(() => {
  727 |       const fgDivs = Array.from(document.querySelectorAll('[style*="height"]'));
  728 |       for (const el of fgDivs) {
  729 |         const s = (el as HTMLElement).style.height;
  730 |         if (s && s.includes('250')) return s;
  731 |       }
  732 |       return null;
  733 |     });
  734 |     expect(height).toMatch(/250/);
  735 |   });
  736 | 
  737 |   test('F2. FLAMEGRAPH accepts semicolon-separated string frames column', async () => {
  738 |     // The flamegraph should render without error given a string frames column
  739 |     const container = page.locator('div[id^="result-container-"]').last();
  740 |     await expect(container).toBeVisible({ timeout: 10_000 });
  741 | 
  742 |     const hasError = await page.evaluate(() => {
  743 |       const errEls = document.querySelectorAll('[class*="Plot render error"], [class*="plot-error"]');
  744 |       return errEls.length > 0;
  745 |     });
  746 |     expect(hasError).toBe(false);
  747 |   });
  748 | });
  749 | 
  750 | // ---------------------------------------------------------------------------
  751 | // Section 16: HEATMAP tooltip and legend
  752 | // ---------------------------------------------------------------------------
  753 | 
  754 | test.describe.serial('Plot: HEATMAP tooltip and legend clauses', () => {
  755 |   test.skip(SKIP, 'SKIP_E2E=1 set');
  756 | 
  757 |   let page: Page;
  758 | 
  759 |   test.beforeAll(async ({ browser }) => {
  760 |     page = await browser.newPage();
  761 |     await gotoDemo(page);
  762 |   });
  763 | 
  764 |   test.afterAll(async () => page.close());
  765 | 
  766 |   test('HM1. HEATMAP renders without error with TOOLTIP and LEGEND clauses', async () => {
  767 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  768 |     await page.waitForTimeout(500);
  769 | 
  770 |     const sqlEd = await getLastSqlEditor(page);
  771 |     if (!sqlEd) { test.skip(); return; }
  772 | 
  773 |     await setCmContent(page, sqlEd, [
  774 |       `SELECT`,
  775 |       `  CASE WHEN duration * 1000 < 20 THEN 'Fast' ELSE 'Slow' END AS speed,`,
  776 |       `  cause AS gc_type,`,
  777 |       `  COUNT(*) AS events`,
  778 |       `FROM GarbageCollection GROUP BY speed, gc_type`,
```