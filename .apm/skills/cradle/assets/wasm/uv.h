/*
  libuv の代わり（mockup-build がランタイムをブラウザ向けに束ねるときだけ include パスに置く）。
  Lean のランタイムの io.cpp は libuv でファイルの情報を読むが、モデル（Protocol.lean の handle）はファイルに触らない。
  libuv を wasm に焼かず、呼ばれたら「対応していない」と返す。エラーの番号は switch の腕が重ならないよう互いに違えば何でもよい。
*/
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <sys/stat.h>

#define UV_VERSION_HEX 0x012D00

enum {
  UV_E2BIG = -1001, UV_EACCES, UV_EADDRINUSE, UV_EADDRNOTAVAIL, UV_EAFNOSUPPORT, UV_EAGAIN, UV_EBADF, UV_EBUSY,
  UV_ECONNABORTED, UV_ECONNREFUSED, UV_ECONNRESET, UV_EDESTADDRREQ, UV_EEXIST, UV_EFAULT, UV_EFBIG, UV_EHOSTUNREACH,
  UV_EILSEQ, UV_EINTR, UV_EINVAL, UV_EIO, UV_EISCONN, UV_EISDIR, UV_ELOOP, UV_EMFILE, UV_EMLINK, UV_EMSGSIZE,
  UV_ENAMETOOLONG, UV_ENETDOWN, UV_ENETUNREACH, UV_ENFILE, UV_ENOBUFS, UV_ENODATA, UV_ENODEV, UV_ENOENT, UV_ENOMEM,
  UV_ENOPROTOOPT, UV_ENOSPC, UV_ENOSYS, UV_ENOTCONN, UV_ENOTDIR, UV_ENOTEMPTY, UV_ENOTSOCK, UV_ENOTSUP, UV_ENOTTY,
  UV_ENXIO, UV_EPERM, UV_EPIPE, UV_EPROTO, UV_EPROTONOSUPPORT, UV_EPROTOTYPE, UV_ERANGE, UV_EROFS, UV_ESPIPE,
  UV_ESRCH, UV_ETIMEDOUT, UV_ETXTBSY, UV_EXDEV
};

typedef struct { long tv_sec; long tv_nsec; } uv_timespec_t;
typedef struct {
  uint64_t st_mode, st_nlink, st_size;
  uv_timespec_t st_atim, st_mtim;
} uv_stat_t;
typedef struct {
  uv_stat_t statbuf;
  const char* path;
  ssize_t result;
} uv_fs_t;

static inline const char* uv_strerror(int err) { (void)err; return "not supported in the browser build"; }
static inline void uv_fs_req_cleanup(uv_fs_t* req) { (void)req; }
static inline int uv_fs_stat(void* l, uv_fs_t* r, const char* p, void* cb) { (void)l; (void)r; (void)p; (void)cb; return UV_ENOSYS; }
static inline int uv_fs_lstat(void* l, uv_fs_t* r, const char* p, void* cb) { (void)l; (void)r; (void)p; (void)cb; return UV_ENOSYS; }
static inline int uv_fs_link(void* l, uv_fs_t* r, const char* a, const char* b, void* cb) { (void)l; (void)r; (void)a; (void)b; (void)cb; return UV_ENOSYS; }
static inline int uv_fs_mkstemp(void* l, uv_fs_t* r, const char* t, void* cb) { (void)l; (void)r; (void)t; (void)cb; return UV_ENOSYS; }
static inline int uv_fs_mkdtemp(void* l, uv_fs_t* r, const char* t, void* cb) { (void)l; (void)r; (void)t; (void)cb; return UV_ENOSYS; }
static inline int uv_fs_unlink(void* l, uv_fs_t* r, const char* p, void* cb) { (void)l; (void)r; (void)p; (void)cb; return UV_ENOSYS; }
static inline int uv_os_tmpdir(char* b, size_t* n) { (void)b; (void)n; return UV_ENOSYS; }
