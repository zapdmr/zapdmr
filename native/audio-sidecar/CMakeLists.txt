cmake_minimum_required(VERSION 3.24)
project(ZapDMRAudio LANGUAGES CXX)

if(NOT WIN32 OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "ZapDMRAudio is currently supported only on Windows x64.")
endif()

add_executable(ZapDMRAudio src/main.cpp)
target_compile_features(ZapDMRAudio PRIVATE cxx_std_20)
target_compile_definitions(ZapDMRAudio PRIVATE UNICODE _UNICODE)
if(MSVC)
  target_compile_options(ZapDMRAudio PRIVATE /W4 /permissive-)
endif()
target_link_libraries(ZapDMRAudio PRIVATE bcrypt ole32 uuid advapi32 propsys)

set_target_properties(ZapDMRAudio PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin"
)
