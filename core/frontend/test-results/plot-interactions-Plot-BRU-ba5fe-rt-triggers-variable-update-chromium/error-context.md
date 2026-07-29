# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plot-interactions.spec.ts >> Plot: BRUSH MODE X >> BR2. Dragging on BRUSH MODE X chart triggers variable update
- Location: e2e/plot-interactions.spec.ts:1291:3

# Error details

```
Error: brush selection overlay visible after drag

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
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
                        - generic "Query execution time" [ref=e914]: 11ms
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
                      - generic [ref=e1133]: SELECT startTime, duration_ms FROM (SELECT *, duration * 100
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
                    - generic [ref=e1160]: SELECT startTime, duration_ms FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime
                - generic [ref=e1164]:
                  - button "+ SQL" [ref=e1165]
                  - button "+ Plot" [ref=e1166]
                  - button "+ Prose" [ref=e1167]
                - generic [ref=e1168]:
                  - generic [ref=e1169]:
                    - generic [ref=e1170] [cursor=pointer]:
                      - img [ref=e1171]
                      - generic [ref=e1173]: Plot 1
                      - generic [ref=e1174]: "LINE_CHART(x: \"startTime\", y: [\"duration_ms\"]) TITLE \"Brush"
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
                      - button "startTime" [ref=e1196]
                      - button "duration_ms" [ref=e1197]
                      - generic [ref=e1198]: — click to copy
                    - textbox [active] [ref=e1203]:
                      - generic [ref=e1204]: "LINE_CHART(x: \"startTime\", y: [\"duration_ms\"])"
                      - generic [ref=e1205]: TITLE "Brush Test"
                      - generic [ref=e1206]:
                        - generic [ref=e1207]: BRUSH
                        - 'generic "Undefined variable: $sel" [ref=e1208] [cursor=pointer]': $sel
                        - generic [ref=e1209]: MODE
                        - generic [ref=e1210]: X
                - generic [ref=e1212]:
                  - button "Download as PNG" [ref=e1213]:
                    - img [ref=e1214]
                  - generic [ref=e1220]:
                    - heading "Brush Test" [level=4] [ref=e1221]
                    - generic [ref=e1225]:
                      - generic [ref=e1226]:
                        - generic: drag=pan · ⇧drag=select · ⇧scroll=zoom
                      - generic [ref=e1229]:
                        - generic:
                          - status:
                            - paragraph: 11:00:43.70
                            - list:
                              - listitem: "duration ms : 189"
                        - list [ref=e1231]:
                          - listitem [ref=e1232]:
                            - img "duration ms legend icon" [ref=e1233]
                            - text: duration ms
                        - application [ref=e1235]:
                          - generic [ref=e1253]:
                            - generic [ref=e1254]:
                              - generic [ref=e1256]: 11:00:01.20
                              - generic [ref=e1258]: 11:00:21.20
                              - generic [ref=e1260]: 11:00:41.20
                              - generic [ref=e1262]: 11:01:01.20
                              - generic [ref=e1264]: 11:01:11.20
                            - generic [ref=e1265]:
                              - generic [ref=e1267]: "0"
                              - generic [ref=e1269]: "60"
                              - generic [ref=e1271]: "120"
                              - generic [ref=e1273]: "180"
                              - generic [ref=e1275]: "240"
                - generic [ref=e1276]:
                  - button "Add variable" [ref=e1277]:
                    - img [ref=e1278]
                    - text: Add variable
                  - button "Add Plot" [ref=e1280]:
                    - img [ref=e1281]
                    - text: Add Plot
                  - button "Add SQL" [ref=e1283]:
                    - img [ref=e1284]
                    - text: Add SQL
                - generic "Drag to resize results" [ref=e1286]
              - button "Add Conclusion" [ref=e1288]:
                - img [ref=e1289]
                - text: Add Conclusion
          - generic [ref=e1291]:
            - generic [ref=e1292]:
              - generic [ref=e1293]:
                - button "Drag to reorder cell" [ref=e1294]:
                  - img [ref=e1295]
                - button "Collapse cell" [ref=e1297]:
                  - img [ref=e1298]
                - heading "Step 4 — Add your own analysis" [level=2] [ref=e1300] [cursor=pointer]
              - generic [ref=e1301]:
                - button "Raw Markdown" [ref=e1302]:
                  - img [ref=e1303]
                - button "Delete Cell" [ref=e1305]:
                  - img [ref=e1306]
            - generic [ref=e1308]:
              - list [ref=e1313] [cursor=pointer]:
                - listitem [ref=e1314]:
                  - text: Click
                  - strong [ref=e1315]: + Add SQL
                  - text: below any cell to add another query, or
                  - strong [ref=e1316]: + Add Cell
                  - text: at the bottom to start fresh.
                - listitem [ref=e1317]:
                  - text: Click
                  - strong [ref=e1318]: Plot syntax
                  - text: beneath any plot block for the full chart reference (LINE_CHART, BAR_CHART, SCATTER_PLOT, HISTOGRAM, FLAMEGRAPH, and more).
                - listitem [ref=e1319]:
                  - text: Click
                  - strong [ref=e1320]: </>
                  - text: in the cell header to edit the prose above as raw Markdown.
                - listitem [ref=e1321]:
                  - text: Try the
                  - strong [ref=e1322]: Schema Explorer
                  - text: on the left — click a table to preview it, or search for a column name across all tables.
                - listitem [ref=e1323]:
                  - text: Open
                  - strong [ref=e1324]: New from template
                  - text: in the toolbar for ready-made GC, allocation, threading, and exception notebooks.
              - generic [ref=e1326]:
                - button "Add variable" [ref=e1327]:
                  - img [ref=e1328]
                  - text: Add variable
                - button "Add Plot" [ref=e1330]:
                  - img [ref=e1331]
                  - text: Add Plot
                - button "Add SQL" [ref=e1333]:
                  - img [ref=e1334]
                  - text: Add SQL
              - button "Add Conclusion" [ref=e1337]:
                - img [ref=e1338]
                - text: Add Conclusion
          - generic [ref=e1340]:
            - generic [ref=e1341]:
              - generic [ref=e1342]:
                - button "Drag to reorder cell" [ref=e1343]:
                  - img [ref=e1344]
                - button "Collapse cell" [ref=e1346]:
                  - img [ref=e1347]
                - heading "New Cell" [level=2] [ref=e1349] [cursor=pointer]
              - generic [ref=e1350]:
                - button "Raw Markdown" [ref=e1351]:
                  - img [ref=e1352]
                - button "Delete Cell" [ref=e1354]:
                  - img [ref=e1355]
            - generic [ref=e1357]:
              - button "Add Introduction" [ref=e1359]:
                - img [ref=e1360]
                - text: Add Introduction
              - generic [ref=e1363]:
                - button "Add variable" [ref=e1364]:
                  - img [ref=e1365]
                  - text: Add variable
                - button "Add Plot" [ref=e1367]:
                  - img [ref=e1368]
                  - text: Add Plot
                - button "Add SQL" [ref=e1370]:
                  - img [ref=e1371]
                  - text: Add SQL
              - button "Add Conclusion" [ref=e1374]:
                - img [ref=e1375]
                - text: Add Conclusion
          - button "Add Cell" [ref=e1378]:
            - img [ref=e1379]
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
      - button "Expand Assistant" [ref=e1381]:
        - img [ref=e1382]
  - generic [ref=e1384]: "0"
```

# Test source

```ts
  1222 |     await page.waitForTimeout(1500);
  1223 | 
  1224 |     const plotEd = await getLastPlotEditor(page);
  1225 |     if (!plotEd) { test.skip(); return; }
  1226 | 
  1227 |     await setCmContent(page, plotEd,
  1228 |       'BAR_CHART(x: "cause", y: ["cnt"])\n  TITLE "Legend Hidden"\n  LEGEND HIDDEN');
  1229 |     await pressRun(page);
  1230 |     await page.waitForTimeout(2000);
  1231 | 
  1232 |     const container = page.locator('div[id^="result-container-"]').last();
  1233 |     await expect(container).toBeVisible({ timeout: 10_000 });
  1234 | 
  1235 |     const hasError = await page.evaluate(() =>
  1236 |       Array.from(document.querySelectorAll('*')).some(el => el.textContent === 'Plot render error')
  1237 |     );
  1238 |     expect(hasError).toBe(false);
  1239 | 
  1240 |     // With LEGEND HIDDEN the legend wrapper should be absent
  1241 |     const legendCount = await container.locator('.recharts-legend-wrapper').count();
  1242 |     expect(legendCount, 'legend hidden').toBe(0);
  1243 |   });
  1244 | });
  1245 | 
  1246 | // ---------------------------------------------------------------------------
  1247 | // Section 25: BRUSH MODE X
  1248 | // ---------------------------------------------------------------------------
  1249 | 
  1250 | test.describe.serial('Plot: BRUSH MODE X', () => {
  1251 |   test.skip(SKIP, 'SKIP_E2E=1 set');
  1252 | 
  1253 |   let page: Page;
  1254 | 
  1255 |   test.beforeAll(async ({ browser }) => {
  1256 |     page = await browser.newPage();
  1257 |     await gotoDemo(page);
  1258 |   });
  1259 | 
  1260 |   test.afterAll(async () => page.close());
  1261 | 
  1262 |   test('BR1. LINE_CHART with BRUSH MODE X renders without error', async () => {
  1263 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  1264 |     await page.waitForTimeout(500);
  1265 | 
  1266 |     const sqlEd = await getLastSqlEditor(page);
  1267 |     if (!sqlEd) { test.skip(); return; }
  1268 | 
  1269 |     await setCmContent(page, sqlEd,
  1270 |       `SELECT startTime, duration_ms FROM (SELECT *, duration * 1000 AS duration_ms FROM GarbageCollection) gc ORDER BY startTime`);
  1271 |     await pressRun(page);
  1272 |     await page.waitForTimeout(1500);
  1273 | 
  1274 |     const plotEd = await getLastPlotEditor(page);
  1275 |     if (!plotEd) { test.skip(); return; }
  1276 | 
  1277 |     await setCmContent(page, plotEd,
  1278 |       'LINE_CHART(x: "startTime", y: ["duration_ms"])\n  TITLE "Brush Test"\n  BRUSH $sel MODE X');
  1279 |     await pressRun(page);
  1280 |     await page.waitForTimeout(2000);
  1281 | 
  1282 |     const container = page.locator('div[id^="result-container-"]').last();
  1283 |     await expect(container).toBeVisible({ timeout: 10_000 });
  1284 | 
  1285 |     const hasError = await page.evaluate(() =>
  1286 |       Array.from(document.querySelectorAll('*')).some(el => el.textContent === 'Plot render error')
  1287 |     );
  1288 |     expect(hasError).toBe(false);
  1289 |   });
  1290 | 
  1291 |   test('BR2. Dragging on BRUSH MODE X chart triggers variable update', async () => {
  1292 |     // The BRUSH $sel chart was added in BR1; find its result container
  1293 |     const container = page.locator('div[id^="result-container-"]').last();
  1294 |     await container.scrollIntoViewIfNeeded();
  1295 |     await page.waitForTimeout(300);
  1296 | 
  1297 |     const box = await container.boundingBox();
  1298 |     if (!box) { test.skip(); return; }
  1299 | 
  1300 |     // Drag across 20%–60% of the chart width to create a brush selection
  1301 |     const startX = box.x + box.width * 0.2;
  1302 |     const endX   = box.x + box.width * 0.6;
  1303 |     const midY   = box.y + box.height * 0.5;
  1304 | 
  1305 |     await page.mouse.move(startX, midY);
  1306 |     await page.mouse.down();
  1307 |     await page.mouse.move(endX, midY, { steps: 15 });
  1308 |     await page.mouse.up();
  1309 |     await page.waitForTimeout(600);
  1310 | 
  1311 |     // After dragging, the select-box overlay should be visible inside the container
  1312 |     const hasSelectBox = await page.evaluate(() => {
  1313 |       const containers = Array.from(document.querySelectorAll('div[id^="result-container-"]'));
  1314 |       const last = containers[containers.length - 1];
  1315 |       if (!last) return false;
  1316 |       const overlays = last.querySelectorAll('div[style*="position: absolute"]');
  1317 |       return Array.from(overlays).some(o => {
  1318 |         const s = o.getAttribute('style') || '';
  1319 |         return s.includes('background') || s.includes('opacity');
  1320 |       });
  1321 |     });
> 1322 |     expect(hasSelectBox, 'brush selection overlay visible after drag').toBe(true);
       |                                                                        ^ Error: brush selection overlay visible after drag
  1323 |   });
  1324 | });
  1325 | 
  1326 | // ---------------------------------------------------------------------------
  1327 | // Section 26: BAR_CHART layout variants (stacked, grouped, horizontal)
  1328 | // ---------------------------------------------------------------------------
  1329 | 
  1330 | test.describe.serial('Plot: BAR_CHART layout variants', () => {
  1331 |   test.skip(SKIP, 'SKIP_E2E=1 set');
  1332 | 
  1333 |   let page: Page;
  1334 | 
  1335 |   test.beforeAll(async ({ browser }) => {
  1336 |     page = await browser.newPage();
  1337 |     await gotoDemo(page);
  1338 |   });
  1339 | 
  1340 |   test.afterAll(async () => page.close());
  1341 | 
  1342 |   test('BA1. BAR_CHART layout:stacked renders without error', async () => {
  1343 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  1344 |     await page.waitForTimeout(500);
  1345 | 
  1346 |     const sqlEd = await getLastSqlEditor(page);
  1347 |     if (!sqlEd) { test.skip(); return; }
  1348 |     await setCmContent(page, sqlEd,
  1349 |       `SELECT bucket_ms(startTime, 10000) AS ts, cause, COUNT(*) AS cnt
  1350 |        FROM GarbageCollection GROUP BY ts, cause ORDER BY ts`);
  1351 |     await pressRun(page);
  1352 |     await page.waitForTimeout(1500);
  1353 | 
  1354 |     const plotEd = await getLastPlotEditor(page);
  1355 |     if (!plotEd) { test.skip(); return; }
  1356 |     await setCmContent(page, plotEd,
  1357 |       'BAR_CHART(x:"ts", y:["cnt"], color:"cause", layout:"stacked")\n  TITLE "Stacked Bar"');
  1358 |     await pressRun(page);
  1359 |     await page.waitForTimeout(2000);
  1360 | 
  1361 |     const container = page.locator('div[id^="result-container-"]').last();
  1362 |     await expect(container).toBeVisible({ timeout: 10_000 });
  1363 |     const hasError = await page.evaluate(() =>
  1364 |       [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
  1365 |     );
  1366 |     expect(hasError).toBe(false);
  1367 |   });
  1368 | 
  1369 |   test('BA2. BAR_CHART layout:grouped renders without error', async () => {
  1370 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  1371 |     await page.waitForTimeout(500);
  1372 | 
  1373 |     const sqlEd = await getLastSqlEditor(page);
  1374 |     if (!sqlEd) { test.skip(); return; }
  1375 |     await setCmContent(page, sqlEd,
  1376 |       `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause ORDER BY cnt DESC LIMIT 5`);
  1377 |     await pressRun(page);
  1378 |     await page.waitForTimeout(1500);
  1379 | 
  1380 |     const plotEd = await getLastPlotEditor(page);
  1381 |     if (!plotEd) { test.skip(); return; }
  1382 |     await setCmContent(page, plotEd,
  1383 |       'BAR_CHART(x:"cause", y:["cnt"], layout:"grouped")\n  TITLE "Grouped Bar"');
  1384 |     await pressRun(page);
  1385 |     await page.waitForTimeout(2000);
  1386 | 
  1387 |     const container = page.locator('div[id^="result-container-"]').last();
  1388 |     await expect(container).toBeVisible({ timeout: 10_000 });
  1389 |     const hasError = await page.evaluate(() =>
  1390 |       [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
  1391 |     );
  1392 |     expect(hasError).toBe(false);
  1393 |   });
  1394 | 
  1395 |   test('BA3. BAR_CHART horizontal:true renders without error', async () => {
  1396 |     await page.getByRole('button', { name: /Add Cell/i }).last().click();
  1397 |     await page.waitForTimeout(500);
  1398 | 
  1399 |     const sqlEd = await getLastSqlEditor(page);
  1400 |     if (!sqlEd) { test.skip(); return; }
  1401 |     await setCmContent(page, sqlEd,
  1402 |       `SELECT cause, COUNT(*) AS cnt FROM GarbageCollection GROUP BY cause ORDER BY cnt DESC LIMIT 5`);
  1403 |     await pressRun(page);
  1404 |     await page.waitForTimeout(1500);
  1405 | 
  1406 |     const plotEd = await getLastPlotEditor(page);
  1407 |     if (!plotEd) { test.skip(); return; }
  1408 |     await setCmContent(page, plotEd,
  1409 |       'BAR_CHART(x:"cause", y:["cnt"], horizontal:true)\n  TITLE "Horizontal Bar"');
  1410 |     await pressRun(page);
  1411 |     await page.waitForTimeout(2000);
  1412 | 
  1413 |     const container = page.locator('div[id^="result-container-"]').last();
  1414 |     await expect(container).toBeVisible({ timeout: 10_000 });
  1415 |     const hasError = await page.evaluate(() =>
  1416 |       [...document.querySelectorAll('*')].some(el => el.textContent === 'Plot render error')
  1417 |     );
  1418 |     expect(hasError).toBe(false);
  1419 |     // Horizontal bar uses a BarChart with layout="vertical" in recharts,
  1420 |     // which renders bar rectangles just like a normal bar chart
  1421 |     const hasBars = await container.locator('.recharts-bar').count();
  1422 |     expect(hasBars, 'bar elements rendered').toBeGreaterThan(0);
```