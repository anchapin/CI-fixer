
[1m[46m RUN [49m[22m [36mv4.0.15 [39m[90mC:/Users/ancha/Documents/projects/CI-fixer[39m

 [32mΓ£ô[39m __tests__/unit/log-analysis-service-parsing.test.ts[2m > [22mLogAnalysisService - Command Parsing[2m > [22mshould strip "Action: " prefix[32m 29[2mms[22m[39m
 [32mΓ£ô[39m __tests__/unit/log-analysis-service-parsing.test.ts[2m > [22mLogAnalysisService - Command Parsing[2m > [22mshould strip "Command: " prefix[32m 4[2mms[22m[39m
 [32mΓ£ô[39m __tests__/unit/log-analysis-service-parsing.test.ts[2m > [22mLogAnalysisService - Command Parsing[2m > [22mshould strip "Run: " prefix[32m 3[2mms[22m[39m
 [32mΓ£ô[39m __tests__/unit/log-analysis-service-parsing.test.ts[2m > [22mLogAnalysisService - Command Parsing[2m > [22mshould strip descriptive prefixes with quotes[32m 3[2mms[22m[39m
 [32mΓ£ô[39m __tests__/unit/log-analysis-service-parsing.test.ts[2m > [22mLogAnalysisService - Command Parsing[2m > [22mshould strip descriptive prefixes with double quotes[32m 4[2mms[22m[39m
 [32mΓ£ô[39m __tests__/unit/log-analysis-service-parsing.test.ts[2m > [22mLogAnalysisService - Command Parsing[2m > [22mshould remove surrounding quotes from single command[32m 3[2mms[22m[39m
 [32mΓ£ô[39m __tests__/unit/log-analysis-service-parsing.test.ts[2m > [22mLogAnalysisService - Command Parsing[2m > [22mshould handle complex natural language instructions[32m 3[2mms[22m[39m
 [31m├ù[39m __tests__/unit/log-analysis-service-parsing.test.ts[2m > [22mLogAnalysisService - Command Parsing[2m > [22mshould preserve valid commands that look like descriptions but aren't[32m 11[2mms[22m[39m
[31m   ΓåÆ expected 'world\'' to be 'echo \'Hello: world\'' // Object.is equality[39m
 [31m├ù[39m __tests__/unit/log-analysis-service-parsing.test.ts[2m > [22mLogAnalysisService - Command Parsing[2m > [22mshould preserve commands with colons naturally[32m 5[2mms[22m[39m
[31m   ΓåÆ expected '/path' to be 'scp file user@host:/path' // Object.is equality[39m

[2m Test Files [22m [1m[31m1 failed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[31m2 failed[39m[22m[2m | [22m[1m[32m7 passed[39m[22m[90m (9)[39m
[2m   Start at [22m 11:20:43
[2m   Duration [22m 988ms[2m (transform 163ms, setup 0ms, import 376ms, tests 66ms, environment 0ms)[22m

