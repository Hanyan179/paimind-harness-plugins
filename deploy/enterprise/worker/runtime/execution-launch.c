// Deployment-owned, exec-only directory descriptor transport. No subprocess
// manager, privilege elevation, timeout, signal forwarding or native policy here.
// The trusted JS projection supplies bwrap options. Only the command following
// its final -- is untrusted. Build without setuid; require bwrap >= 0.10 bind-fd.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static _Noreturn void fail(const char *message) {
  fprintf(stderr, "Execution directory launch rejected: %s\n", message);
  exit(125);
}

// Run INSIDE the completed boundary. Put the actual terminal command in the
// foreground of the existing native-owned session. Otherwise group signalling
// also interrupts bwrap's monitor, racing its die-with-parent cleanup against
// the command's signal handler. No fork, new session or signal disposition is
// introduced; native foreground inspection/signalling and cleanup stay intact.
static _Noreturn void terminal_command(char **command) {
  if (!isatty(STDIN_FILENO) || !isatty(STDOUT_FILENO)) fail("terminal required");
  sigset_t blocked, previous;
  if (sigemptyset(&blocked) != 0 || sigaddset(&blocked, SIGTTOU) != 0 ||
      sigprocmask(SIG_BLOCK, &blocked, &previous) != 0) fail("prepare terminal foreground");
  if (setpgid(0, 0) != 0 || tcsetpgrp(STDIN_FILENO, getpgrp()) != 0)
    fail("set terminal foreground");
  if (sigprocmask(SIG_SETMASK, &previous, NULL) != 0) fail("restore terminal signal mask");
  execvp(command[0], command);
  fail("execute terminal command");
}

static int within(const char *path, const char *root) {
  const size_t length = strlen(root);
  return strncmp(path, root, length) == 0 &&
    (path[length] == '\0' || path[length] == '/');
}

// Every component is opened relative to a live directory descriptor. O_NOFOLLOW
// on one multi-component open alone would not reject intermediate symlinks.
static int walk(int anchor, const char *relative) {
  int current = fcntl(anchor, F_DUPFD_CLOEXEC, 3);
  if (current < 0) fail("duplicate directory");
  if (*relative == '\0') return current;
  char *parts = strdup(relative);
  if (parts == NULL) fail("allocate directory path");
  char *rest = parts;
  char *part;
  while ((part = strsep(&rest, "/")) != NULL) {
    if (*part == '\0' || strcmp(part, ".") == 0 || strcmp(part, "..") == 0)
      fail("non-canonical directory");
    int next = openat(current, part, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (next < 0) fail("directory component unavailable or symbolic link");
    if (close(current) != 0) fail("close directory");
    current = next;
  }
  free(parts);
  return current;
}

static void verify_identity(int fd, const char *expected) {
  struct stat info;
  if (fstat(fd, &info) != 0) fail("read prepared directory identity");
  char actual[128];
  int length = snprintf(actual, sizeof(actual), "%" PRIuMAX ":%" PRIuMAX,
    (uintmax_t)info.st_dev, (uintmax_t)info.st_ino);
  if (length < 0 || (size_t)length >= sizeof(actual) || strcmp(actual, expected) != 0)
    fail("prepared directory identity changed");
}

int main(int argc, char **argv) {
  if (argc >= 4 && strcmp(argv[1], "--terminal-command") == 0 && strcmp(argv[2], "--") == 0)
    terminal_command(&argv[3]);
  static const char prefix[] = "/var/lib/paimind/workspaces/";
  static const char temp_prefix[] = "/var/lib/paimind/temporary/";
  static const char resource_prefix[] = "/var/lib/paimind/resources/";
  if (argc < 7) fail("invalid arguments");
  int marker = 5;
  const char *base_identity = NULL;
  const char *write_identity = NULL;
  const char *directory_target = NULL;
  if (strcmp(argv[5], "--scope-identities") == 0) {
    if (argc < 10) fail("invalid prepared arguments");
    base_identity = argv[6]; write_identity = argv[7]; marker = 8;
  }
  if (strcmp(argv[marker], "--directory-target") == 0) {
    if (argc < marker + 4) fail("invalid directory arguments");
    directory_target = argv[marker + 1]; marker += 2;
  }
  if (strcmp(argv[marker], "--") != 0) fail("invalid arguments");
  const int options = marker + 1;
  const char *base = argv[1];
  const char *writable = argv[2];
  const char *temporary = argv[3];
  const char *resources = argv[4];
  if (strcmp(base, "/var/lib/paimind/workspace") == 0) {
    if (strcmp(temporary, "/var/lib/paimind/temporary") != 0 ||
        strcmp(resources, "/var/lib/paimind/resources") != 0) fail("invalid single-cell directories");
  } else {
    if (strncmp(base, prefix, sizeof(prefix) - 1) != 0 ||
        strlen(base) <= sizeof(prefix) - 1) fail("invalid member root");
    if (strncmp(temporary, temp_prefix, sizeof(temp_prefix) - 1) != 0 ||
      strcmp(temporary + sizeof(temp_prefix) - 1, base + sizeof(prefix) - 1) != 0)
      fail("temporary directory belongs to a different world");
    if (strncmp(resources, resource_prefix, sizeof(resource_prefix) - 1) != 0 ||
      strcmp(resources + sizeof(resource_prefix) - 1, base + sizeof(prefix) - 1) != 0)
      fail("resource directory belongs to a different world");
  }
  if (strcmp(writable, "-") != 0 && !within(writable, base)) fail("writable root outside member root");
  if (directory_target != NULL && (!within(directory_target, base) ||
      (strcmp(writable, "-") != 0 && strcmp(writable, base) != 0))) fail("directory target outside member root");
  int anchor = open("/", O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (anchor < 0) fail("open root anchor");
  int base_fd = walk(anchor, base + 1);
  int temp_fd = walk(anchor, temporary + 1);
  int resource_fd = walk(anchor, resources + 1);
  if (close(anchor) != 0) fail("close root anchor");
  int write_fd = -1;
  if (strcmp(writable, "-") != 0) {
    const char *relative = writable + strlen(base);
    if (*relative == '/') relative++;
    write_fd = walk(base_fd, relative);
  }
  if (base_identity != NULL) {
    verify_identity(base_fd, base_identity);
    if (write_fd >= 0) verify_identity(write_fd, write_identity);
    else if (strcmp(write_identity, "-") != 0) fail("unexpected readonly identity");
  }
  int directory_fd = -1;
  if (directory_target != NULL) {
    const char *relative_path = directory_target + strlen(base);
    if (*relative_path == '/') relative_path++;
    directory_fd = walk(base_fd, relative_path);
  }
  // These are the only descriptors opened here that survive exec. bwrap takes
  // ownership, validates the mount's device/inode and closes them before the
  // member command; native subprocess still owns standard IO and the process.
  if (fcntl(base_fd, F_SETFD, 0) < 0 || fcntl(temp_fd, F_SETFD, 0) < 0 ||
      fcntl(resource_fd, F_SETFD, 0) < 0 ||
      (write_fd >= 0 && fcntl(write_fd, F_SETFD, 0) < 0) ||
      (directory_fd >= 0 && fcntl(directory_fd, F_SETFD, 0) < 0)) fail("transfer directory descriptors");
  char base_number[32], write_number[32], temp_number[32], resource_number[32], directory_number[32];
  if (snprintf(base_number, sizeof(base_number), "%d", base_fd) < 0 ||
      snprintf(write_number, sizeof(write_number), "%d", write_fd) < 0 ||
      snprintf(temp_number, sizeof(temp_number), "%d", temp_fd) < 0 ||
      snprintf(resource_number, sizeof(resource_number), "%d", resource_fd) < 0 ||
      snprintf(directory_number, sizeof(directory_number), "%d", directory_fd) < 0) fail("format directory descriptor");
  char **command = calloc((size_t)argc + 15, sizeof(char *));
  if (command == NULL) fail("allocate command");
  size_t at = 0;
  command[at++] = "/usr/local/bin/bwrap";
  command[at++] = "--ro-bind-fd";
  command[at++] = base_number;
  command[at++] = argv[1];
  if (write_fd >= 0) {
    command[at++] = "--bind-fd";
    command[at++] = write_number;
    command[at++] = argv[2];
  }
  command[at++] = write_fd >= 0 ? "--bind-fd" : "--ro-bind-fd";
  command[at++] = temp_number;
  command[at++] = "/tmp";
  command[at++] = "--ro-bind-fd";
  command[at++] = resource_number;
  command[at++] = argv[4];
  if (directory_fd >= 0) {
    // Narrow this one native browse helper to its pinned parent. The mount
    // root cannot be swapped by the member after validation. No /proc, extra
    // namespace, manager or writable host directory is exposed.
    command[at++] = write_fd >= 0 ? "--bind-fd" : "--ro-bind-fd";
    command[at++] = directory_number;
    command[at++] = argv[1];
  }
  for (int i = options; i < argc; i++) command[at++] = argv[i];
  command[at] = NULL;
  execv(command[0], command);
  fail("execute isolation tool");
}
