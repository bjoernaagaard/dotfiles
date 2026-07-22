.PHONY: all test

all:
	(cd cpu_load && $(MAKE))
	(cd network_load && $(MAKE))

test:
	clang -std=c99 -Wall -Wextra -Werror tests/format_message_test.c -o /tmp/sketchybar-format-message-test
	/tmp/sketchybar-format-message-test
	rm /tmp/sketchybar-format-message-test
