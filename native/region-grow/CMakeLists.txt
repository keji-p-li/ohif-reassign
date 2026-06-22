cmake_minimum_required(VERSION 3.16)
project(quiqvu_region_grow_wasm LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(region_grow_core
  src/region_grow.cpp
)

target_include_directories(region_grow_core PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

add_executable(region_grow_tests
  tests/region_grow_tests.cpp
)

target_link_libraries(region_grow_tests PRIVATE region_grow_core)

enable_testing()
add_test(NAME region_grow_tests COMMAND region_grow_tests)
