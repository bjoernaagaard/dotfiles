#include "../sketchybar.h"

#include <assert.h>
#include <stdio.h>
#include <string.h>

static void assert_formatted_message(const char *message,
                                     const char *expected,
                                     size_t expected_length) {
  char output[strlen(message) + 2];
  memset(output, 0, sizeof(output));

  uint32_t count = format_message(message, output);

  assert(count == expected_length);
  assert(memcmp(output, expected, expected_length) == 0);
}

int main(void) {
  static const char cpu_expected[] =
      "--trigger\0cpu_update\0total_load=42\0";
  static const char network_expected[] =
      "--trigger\0network_update\0label=hello world\0";
  static const char empty_expected[] = "\0";

  assert_formatted_message("--trigger 'cpu_update' total_load='42'",
                           cpu_expected,
                           sizeof(cpu_expected));
  assert_formatted_message("--trigger 'network_update' label='hello world'",
                           network_expected,
                           sizeof(network_expected));
  assert_formatted_message("", empty_expected, sizeof(empty_expected));

  puts("format_message tests: PASS");
  return 0;
}
